import type { IncomingMessage, ServerResponse } from "node:http";
import { pool } from "./db.ts";
import { HttpError, uuid } from "./auth.ts";

const historyCache = new Map<string,{expires:number;data:Record<string,unknown>}>();
function range(url: URL) {
  const end = url.searchParams.get("to") ? Date.parse(url.searchParams.get("to")!) : Date.now();
  const start = url.searchParams.get("from") ? Date.parse(url.searchParams.get("from")!) : end - 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new HttpError(400, "Choose a valid time range");
  return { start: new Date(start), end: new Date(end) };
}
function json(res: ServerResponse, data: unknown) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
export async function owletHistory(req: IncomingMessage, res: ServerResponse, url: URL, family: string) {
  if (req.method !== "GET" || !["/api/owlet/history", "/api/owlet/export", "/api/owlet/file", "/api/owlet/poll", "/api/owlet/sample"].includes(url.pathname)) return false;
  const child = uuid(url.searchParams.get("child"));
  if (url.pathname === "/api/owlet/sample") {
    const at = Date.parse(url.searchParams.get("at") ?? "");
    const { start,end } = range(url);
    if (!Number.isFinite(at)) throw new HttpError(400,"Invalid inspection time");
    const params=[family,child,start,end,new Date(at)];
    // Two indexed candidates avoid scanning/sorting every reading by distance.
    const q=await pool.query(`SELECT * FROM (
      (SELECT * FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4 AND measured_at<=$5 ORDER BY measured_at DESC LIMIT 1)
      UNION ALL
      (SELECT * FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4 AND measured_at>$5 ORDER BY measured_at ASC LIMIT 1)
    ) candidates ORDER BY abs(extract(epoch FROM measured_at-$5::timestamptz)) LIMIT 1`,params);
    const reading=q.rows[0]??null;
    let previous=null,next=null;
    if(reading){
      const p=await pool.query(`SELECT
        (SELECT measured_at FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$5 ORDER BY measured_at DESC LIMIT 1) AS previous,
        (SELECT measured_at FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at<$4 AND measured_at>$5 ORDER BY measured_at ASC LIMIT 1) AS next`,[family,child,start,end,reading.measured_at]);
      previous=p.rows[0].previous;next=p.rows[0].next;
    }
    json(res,{reading,previous,next});return true;
  }
  if (url.pathname === "/api/owlet/poll") {
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) throw new HttpError(400, "Invalid collection log");
    const q = await pool.query("SELECT * FROM owlet_polls WHERE id=$1 AND family_id=$2 AND child_id=$3", [id,family,child]);
    if (!q.rowCount) throw new HttpError(404, "Collection log is not available");
    json(res,q.rows[0]);
    return true;
  }
  if (url.pathname === "/api/owlet/file") {
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) throw new HttpError(400, "Invalid file");
    const q = await pool.query("SELECT content FROM owlet_log_files WHERE id=$1 AND family_id=$2 AND child_id=$3 AND downloaded_at IS NOT NULL", [id, family, child]);
    if (!q.rowCount) throw new HttpError(404, "Archived file is not available");
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="owlet-log-${id}.bin"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(q.rows[0].content);
    return true;
  }
  if (url.pathname === "/api/owlet/export") {
    const dataset = url.searchParams.get("dataset") ?? "readings";
    const tables: Record<string, string> = { readings: "owlet_readings", polls: "owlet_polls", files: "owlet_log_files", alerts: "owlet_alert_events" };
    const table = tables[dataset];
    const format = url.searchParams.get("format") ?? "jsonl";
    if (!table || !["jsonl", "csv"].includes(format)) throw new HttpError(400, "Invalid export format");
    const { start, end } = range(url);
    const hasRange = url.searchParams.has("from") || url.searchParams.has("to");
    const timeColumn = dataset === "polls" ? "fetched_at" : dataset === "files" ? "discovered_at" : "measured_at";
    // Freeze the upper id so a continuous collector cannot make the export endless.
    const max = await pool.query(`SELECT coalesce(max(id),0) AS id FROM ${table} WHERE family_id=$1 AND child_id=$2`, [family, child]);
    res.writeHead(200, { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson", "Content-Disposition": `attachment; filename="owlet-${dataset}.${format}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    let last = "0";
    let headers: string[] | null = null;
    const write = async (data: string) => {
      if (!res.write(data)) await new Promise<void>((resolve) => {
        const done = () => { res.removeListener("drain",done); res.removeListener("close",done); resolve(); };
        res.once("drain",done); res.once("close",done);
      });
    };
    while (!res.destroyed) {
      const q = await pool.query(`SELECT * FROM ${table} WHERE family_id=$1 AND child_id=$2 AND id>$3 AND id<=$4 ${hasRange ? `AND ${timeColumn}>=$5 AND ${timeColumn}<$6` : ""} ORDER BY id LIMIT ${dataset === "files" ? 1 : 25}`, hasRange ? [family, child, last, max.rows[0].id, start, end] : [family, child, last, max.rows[0].id]);
      if (!q.rowCount) break;
      for (const row of q.rows) {
        if (dataset === "files" && row.content) row.content = row.content.toString("base64");
        if (format === "jsonl") await write(JSON.stringify(row) + "\n");
        else {
          if (!headers) { headers = Object.keys(row); await write(headers.join(",") + "\r\n"); }
          const cells = headers.map((key) => {
            let value = row[key] == null ? "" : typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key]);
            if (/^[=+@-]/.test(value)) value = "'" + value;
            return '"' + value.replaceAll('"', '""') + '"';
          });
          await write(cells.join(",") + "\r\n");
        }
        last = row.id;
      }
    }
    res.end();
    return true;
  }
  const { start, end } = range(url);
  const span = end.getTime() - start.getTime();
  if (span > 366 * 86400000) throw new HttpError(400, "Graph ranges are limited to one year; exports include all history");
  const seconds = [5, 30, 60, 300, 3600, 21600, 86400].find((s) => span / 1000 / s <= 1200) ?? 86400;
  const cacheKey = span>7*86400000 ? `${family}:${child}:${Math.round(span/60000)}:${Math.floor(end.getTime()/5000)}` : "";
  const cached=historyCache.get(cacheKey);
  if(cached && cached.expires>Date.now()){
    const settings=await pool.query("SELECT oxygen_below,heart_below,heart_above,battery_below,repeat_until_accepted FROM owlet_alert_settings WHERE family_id=$1 AND child_id=$2",[family,child]);
    json(res,{...cached.data,settings:settings.rows[0]??null});return true;
  }
  const params = [family, child, start, end];
  const [readings, alerts, settings, files, archive, gaps, attempts] = await Promise.all([
    pool.query(seconds===5 ? `SELECT measured_at,measured_at AS first_at,measured_at AS last_at,1 AS samples,
      nullif(heart_rate,0) AS heart_rate,nullif(heart_rate,0) AS heart_min,nullif(heart_rate,0) AS heart_max,
      nullif(oxygen_percent,0)::float AS oxygen_percent,nullif(oxygen_percent,0)::float AS oxygen_min,nullif(oxygen_percent,0)::float AS oxygen_max,
      movement,movement AS movement_min,movement AS movement_max,battery_percent::float AS battery_percent,sleep_state,sock_connection,charging,
      CASE WHEN jsonb_typeof(provider_data->'vitals'->'rsi')='number' THEN (provider_data->'vitals'->>'rsi')::float END AS signal
      FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4 ORDER BY measured_at` : `SELECT date_bin($5::interval,measured_at,'2000-01-01'::timestamptz) AS measured_at,
      min(measured_at) AS first_at,max(measured_at) AS last_at,count(*)::int AS samples,
      avg(heart_rate) FILTER(WHERE heart_rate>0)::float AS heart_rate,min(heart_rate) FILTER(WHERE heart_rate>0) AS heart_min,max(heart_rate) FILTER(WHERE heart_rate>0) AS heart_max,
      avg(oxygen_percent) FILTER(WHERE oxygen_percent>0)::float AS oxygen_percent,min(oxygen_percent) FILTER(WHERE oxygen_percent>0)::float AS oxygen_min,max(oxygen_percent) FILTER(WHERE oxygen_percent>0)::float AS oxygen_max,
      avg(movement)::float AS movement,min(movement) AS movement_min,max(movement) AS movement_max,
      avg(battery_percent)::float AS battery_percent,
      (array_agg(sleep_state ORDER BY measured_at DESC))[1] AS sleep_state,
      (array_agg(sock_connection ORDER BY measured_at DESC))[1] AS sock_connection,
      (array_agg(charging ORDER BY measured_at DESC))[1] AS charging,
      avg(CASE WHEN jsonb_typeof(provider_data->'vitals'->'rsi')='number' THEN (provider_data->'vitals'->>'rsi')::float END) AS signal
      FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4
      GROUP BY 1 ORDER BY 1`, seconds===5 ? params : [...params, `${seconds} seconds`]),
    pool.query("SELECT id,kind,measured_value,threshold_value,measured_at FROM owlet_alert_events WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4 ORDER BY measured_at", params),
    pool.query("SELECT oxygen_below,heart_below,heart_above,battery_below,repeat_until_accepted FROM owlet_alert_settings WHERE family_id=$1 AND child_id=$2", [family, child]),
    pool.query("SELECT id,property_name,discovered_at,downloaded_at,content_type,sha256,octet_length(content) AS bytes,last_error FROM owlet_log_files WHERE family_id=$1 AND child_id=$2 ORDER BY discovered_at DESC LIMIT 100", [family, child]),
    pool.query("SELECT count(*) AS polls,count(*) FILTER(WHERE status='error') AS errors,max(fetched_at) AS last_poll,min(fetched_at) AS first_poll,avg(duration_ms)::int AS average_duration_ms FROM owlet_polls WHERE family_id=$1 AND child_id=$2 AND fetched_at>=$3 AND fetched_at<$4", params),
    pool.query(`WITH points AS (SELECT measured_at,lead(measured_at) OVER(ORDER BY measured_at) AS next_at FROM owlet_readings WHERE family_id=$1 AND child_id=$2 AND measured_at>=$3 AND measured_at<$4)
      SELECT measured_at AS "from",next_at AS "to" FROM points WHERE next_at-measured_at>interval '90 seconds'`, params),
    pool.query("SELECT id,fetched_at,status,duration_ms,http_status,error FROM owlet_polls WHERE family_id=$1 AND child_id=$2 AND fetched_at>=$3 AND fetched_at<$4 ORDER BY fetched_at DESC LIMIT 20", params),
  ]);
  const data = { readings: readings.rows, alerts: alerts.rows, settings: settings.rows[0] ?? null, files: files.rows, archive: archive.rows[0], gaps: gaps.rows, attempts: attempts.rows, bucketSeconds: seconds, from: start, to: end };
  if(cacheKey){if(historyCache.size>=16)historyCache.delete(historyCache.keys().next().value!);historyCache.set(cacheKey,{expires:Date.now()+(end.getTime()<Date.now()-60000 ? 60000 : 5000),data});}
  json(res,data);
  return true;
}
