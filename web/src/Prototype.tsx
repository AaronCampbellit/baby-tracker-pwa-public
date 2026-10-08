import { OwletUrgentAlerts } from "./OwletUrgentAlerts";
import { enableOwletAlertSound, alertSoundReady, soundEvent, watchAlertSound } from "./domain/alert-sound";
import { notificationPreferences, setNotificationPreferences, notificationPreferencesEvent, notificationPreferencesChanged } from "./domain/notification-preferences";
import { clearAlertBadge, setAlertBadge, refreshAlertBadge } from "./domain/badges";
import { copyInvitation, shareInvitation } from "./domain/invitations";
import { checkOfflineStorage, offlineStorageStatus } from "./domain/offline-storage";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HomeIcon,
  CalendarIcon,
  BarChartIcon,
  PersonIcon,
  MoonIcon,
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GearIcon,
  SunIcon,
  HeartIcon,
  DownloadIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  Cross2Icon,
} from "@radix-ui/react-icons";
import {
  MobileScroll,
  Select,
  SwipeNotice,
  applyBabyTheme,
  BottomSheet,
  KeyboardInput,
  KeyboardTextarea,
} from "./ui";
import { api, clearCloud, identity, familyId } from "./domain/cloud";
import { reconcilePushRegistration, watchPushRegistration, disablePush, enablePush, testPush, type DevicePushStatus } from "./domain/notifications";
import { BabyIcon, DropIcon, BatteryHighIcon, BowlFoodIcon, RulerIcon, PillIcon, StarIcon, BookOpenIcon, FlowerIcon } from "@phosphor-icons/react";
import {
  load,
  sync,
  syncStatus,
  acceptRemote,
  clearLocal,
  persist,
  selectChild,
  age,
  duration,
  timerElapsed,
  todayKey,
  sleepForDay,
  exportCSV,
  type Activity,
  type Kind,
  type State,
} from "./domain/store";
import {
  inspectNaraFile,
  importNaraFiles,
  type NaraPreview,
} from "./domain/nara-import";
import { exportNaraCSV } from "./domain/nara-export";
import "./prototype.css";
const tabs = ["Today", "History", "Trends", "Family"] as const;
const icons = [HomeIcon, CalendarIcon, BarChartIcon, PersonIcon];
const fieldSpecs: Partial<Record<Kind, string[][]>> = {
  Nursing: [
    ["side", "Side", "Left|Right|Both"],
    ["minutes", "Duration (minutes)"],
  ],
  Pumping: [
    ["side", "Side", "Left|Right|Both"],
    ["minutes", "Duration (minutes)"],
  ],
  Diaper: [["rash", "Rash", "No|Yes"]],
  Solids: [
    ["food", "Food"],
    ["reaction", "Reaction / tolerance"],
  ],
  Growth: [
    ["weight", "Weight (kg)"],
    ["height", "Length / height (cm)"],
    ["head", "Head circumference (cm)"],
  ],
  Medication: [
    ["medicine", "Medication name"],
    ["dose", "Amount given (include unit)"],
  ],
  Milestone: [["milestone", "Milestone"]],
  Routine: [
    ["routine", "Routine", "Tummy time|Bath|Story time|Other"],
    ["minutes", "Duration (minutes)"],
  ],
  Pregnancy: [
    [
      "category",
      "Category",
      "Symptoms|Weight|Blood pressure|Blood sugar|Mood|Journal|Appointment",
    ],
    ["value", "Value / observation"],
  ],
  Postpartum: [
    [
      "category",
      "Category",
      "Recovery|Hydration|Food|Sleep|Mood|Journal|Self-care",
    ],
    ["value", "Value / observation"],
  ],
};
const kinds: Kind[] = [
  "Feed",
  "Diaper",
  "Sleep",
  "Nursing",
  "Pumping",
  "Solids",
  "Growth",
  "Medication",
  "Milestone",
  "Routine",
  "Pregnancy",
  "Postpartum",
  "Spasm",
];
const spasmFeatures = [
  "Eye movement",
  "Tongue movement",
  "Arching",
  "Leg kicking",
];
type OwletReading = {
  measured_at: string;
  heart_rate: number | null;
  oxygen_percent: number | null;
  battery_percent: number | null;
  movement: number | null;
  sleep_state: number | null;
  sock_connection: number | null;
  charging: boolean | null;
  alerts: Record<string, boolean>;
  provider_data: { vitals?: Record<string, unknown>; properties?: Record<string, unknown> };
};
type OwletConnection = Omit<OwletReading, "measured_at" | "provider_data"> & {
  measured_at: string | null;
  child_id: string;
  device_serial: string;
  device_name: string;
  account_email: string;
  last_polled_at: string | null;
  last_error: string | null;
  latest_alert_at: string | null;
  latest_alert_kind: string | null;
  next_poll_at: string;
  failure_count: number;
  last_duration_ms: number | null;
};
type OwletStatus = { configured: boolean; connections: OwletConnection[] };
type OwletAlertEvent = {
  id: number;
  kind: string;
  measured_value: number;
  threshold_value: number;
  measured_at: string;
  created_at: string;
  repeat_until_accepted?: boolean;
  acknowledged_at?: string | null;
};
type OwletAlertFields = { oxygenBelow: string; heartBelow: string; heartAbove: string; batteryBelow: string };
type OwletGraphPoint = Omit<OwletReading, "provider_data" | "alerts"> & {
  first_at: string; last_at: string; samples: number; signal: number | null;
  heart_min: number | null; heart_max: number | null;
  oxygen_min: number | null; oxygen_max: number | null;
  movement_min: number | null; movement_max: number | null;
};
type OwletHistoryData = {
  demo?: boolean;
  readings: OwletGraphPoint[]; alerts: OwletAlertEvent[];
  settings: { oxygen_below: number | null; heart_below: number | null; heart_above: number | null; battery_below: number | null } | null;
  archive: { polls: string; errors: string; last_poll: string | null; average_duration_ms: number | null };
  files: { id: string; property_name: string; downloaded_at: string | null; bytes: number | null; last_error: string | null }[];
  bucketSeconds: number; from: string; to: string;
  gaps: { from: string; to: string }[];
  attempts: { id: string; fetched_at: string; status: string; duration_ms: number; http_status: number | null; error: string | null }[];
};
function demoOwletHistory(end: number, hours: number): OwletHistoryData {
  const start=end-hours*3600000, count=361, interval=(end-start)/(count-1);
  const readings: OwletGraphPoint[]=Array.from({length:count},(_,i)=>{
    const t=new Date(start+i*interval).toISOString();
    const heart=Math.round(124+15*Math.sin(i/17)+7*Math.sin(i/5));
    const oxygen=Number((97.5+1.4*Math.sin(i/23)).toFixed(1));
    const movement=Math.round(Math.max(0,3+3*Math.sin(i/11)));
    return { measured_at:t,first_at:t,last_at:t,samples:1,
      heart_rate:heart,heart_min:heart,heart_max:heart,
      oxygen_percent:oxygen,oxygen_min:oxygen,oxygen_max:oxygen,
      movement,movement_min:movement,movement_max:movement,
      battery_percent:Math.round(95-i/18),signal:Math.round(-48+8*Math.sin(i/31)),
      sleep_state:i<230?1:2,sock_connection:1,charging:false,
    };
  }).filter((_,i)=>i<140 || i>150);
  return { demo:true, from:new Date(start).toISOString(),to:new Date(end).toISOString(),
    readings,bucketSeconds:Math.max(5,Math.ceil(interval/1000)),alerts:[],settings:null,
    gaps:[{from:new Date(start+140*interval).toISOString(),to:new Date(start+150*interval).toISOString()}],
    archive:{polls:String(readings.length),errors:'0',last_poll:new Date(end).toISOString(),average_duration_ms:120},
    files:[],attempts:[],
  };
}
// Round outward to readable increments while retaining all readings and alert levels.
function graphScale(min: number, max: number, intervals = 6, minimumStep = 1) {
  const desired = Math.max(minimumStep, (max - min) / intervals);
  const magnitude = 10 ** Math.floor(Math.log10(desired));
  const step = Math.max(minimumStep, ([1, 2, 2.5, 3, 5, 10].find(n => n * magnitude >= desired) ?? 10) * magnitude);
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(lo + step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Number((lo + i * step).toFixed(6)));
  return { lo, hi, ticks };
}
// A move-only SVG path has no stroke. Keep isolated samples as explicit dots,
// and never join a series across invalid readings or missing-data intervals.
function owletGraphSegments(data: OwletHistoryData, key: keyof OwletGraphPoint, x: (time:number)=>number, y: (value:number)=>number) {
  const segments: { d:string; point:{x:number;y:number}|null }[]=[];
  const gaps=data.gaps.map(g=>({from:Date.parse(g.from),to:Date.parse(g.to)})).sort((a,b)=>a.from-b.from);
  let gapIndex=0,d="",count=0,previous:number|null=null,point:{x:number;y:number}|null=null;
  const flush=()=>{
    if(d)segments.push({d,point:count===1 ? point : null});
    d="";count=0;point=null;
  };
  for(const reading of data.readings){
    const time=Date.parse(reading.measured_at),value=reading[key];
    if(typeof value!=="number" || !Number.isFinite(value) || (/heart|oxygen/.test(key) && value<=0)){
      flush();previous=null;continue;
    }
    if(previous!==null){
      while(gapIndex<gaps.length && gaps[gapIndex].to<=previous)gapIndex++;
      if(Date.parse(reading.first_at)-previous>Math.max(90000,data.bucketSeconds*1500) ||
        (gapIndex<gaps.length && gaps[gapIndex].from<time))flush();
    }
    point={x:x(time),y:y(value)};
    d+=`${d ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    count++;previous=Date.parse(reading.last_at);
  }
  flush();
  return segments;
}
const owletRanges: [number,string][] = [[1/6,"10 min"],[.5,"30 min"],[1,"1 hour"],[6,"6 hours"],[12,"12 hours"],[24,"1 day"],[168,"7 days"],[336,"14 days"],[720,"1 month"],[2160,"3 months"],[4320,"6 months"],[8760,"1 year"]];
function pollOwletInForeground(load:()=>Promise<void>,interval:number|null) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(!document.hidden)void load();};
  const schedule=()=>{
    if(interval!==null)timer=setTimeout(()=>{refresh();schedule();},interval-Date.now()%interval);
  };
  refresh();schedule();
  window.addEventListener("focus",refresh);
  window.addEventListener("online",refresh);
  document.addEventListener("visibilitychange",refresh);
  return()=>{
    clearTimeout(timer);
    window.removeEventListener("focus",refresh);
    window.removeEventListener("online",refresh);
    document.removeEventListener("visibilitychange",refresh);
  };
}
const OwletGraphs = memo(function OwletGraphs({ data, activities, childId, overviewMetrics, onMetricChange, focused, onFocus, inspectionTime }: { data: OwletHistoryData; activities: Activity[]; childId: string; overviewMetrics: string[]; onMetricChange:(metric:string)=>void; focused: string | null; onFocus: (metric:string)=>void; inspectionTime:{current:number|null} }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [sample, setSample] = useState<{reading:OwletReading|null;previous:string|null;next:string|null}|null>(null);
  const [sampleError,setSampleError] = useState("");
  const [sampleLoading,setSampleLoading] = useState(false);
  const cursorRef = useRef<number|null>(null);
  useEffect(() => {cursorRef.current=cursor;},[cursor]);
  useEffect(() => {const at=inspectionTime.current;setCursor(focused && at!==null && at>=Date.parse(data.from) && at<=Date.parse(data.to) ? at : data.readings.at(-1) ? Date.parse(data.readings.at(-1)!.measured_at) : null);setSample(null);},[Date.parse(data.to)-Date.parse(data.from)]);
  const start = Date.parse(data.from), end = Date.parse(data.to);
  useEffect(() => {
    if (!focused || data.demo) return;
    let current=true,pending=false,lastAt:number|null=null;
    const load=async () => {
      const at=cursorRef.current;
      if(pending || at===null || at===lastAt) return;
      pending=true;lastAt=at;setSampleLoading(true);setSampleError("");
      try {
        const result=await api(`/owlet/sample?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(childId)}&at=${new Date(at).toISOString()}&from=${data.from}&to=${data.to}`);
        if(current)setSample(result);
      } catch(error){if(current){setSample(null);setSampleError(error instanceof Error ? error.message : "Could not inspect this reading.");}}
      finally{pending=false;if(current)setSampleLoading(false);}
    };
    void load();const timer=setInterval(()=>void load(),150);
    return()=>{current=false;clearInterval(timer);};
  },[focused,childId,start,end]);
  useEffect(()=>{
    if(!data.demo || !focused || cursor===null)return;
    const index=data.readings.reduce((best,row,i)=>Math.abs(Date.parse(row.measured_at)-cursor)<Math.abs(Date.parse(data.readings[best].measured_at)-cursor)?i:best,0);
    const point=data.readings[index];
    if(point)setSample({reading:{...point,alerts:{},provider_data:{vitals:{rsi:point.signal}}},previous:data.readings[index-1]?.measured_at ?? null,next:data.readings[index+1]?.measured_at ?? null});
  },[data,focused,cursor]);
  const inspect = (time:number) => {inspectionTime.current=time;cursorRef.current=time;setCursor(time);};
  const markers = useMemo(() => activities.filter((a) => a.childId === childId && !a.deleted && ["Feed", "Nursing", "Sleep", "Spasm"].includes(a.kind) && a.start >= start && a.start <= end), [activities,childId,start,end]);
  const specs = [
    { key: "heart_rate", label: "Heart rate", unit: "bpm", color: "var(--owlet-heart)", minKey: "heart_min", maxKey: "heart_max", thresholds: [data.settings?.heart_below, data.settings?.heart_above] },
    { key: "oxygen_percent", label: "Oxygen", unit: "%", color: "var(--owlet-oxygen)", minKey: "oxygen_min", maxKey: "oxygen_max", thresholds: [data.settings?.oxygen_below] },
    { key: "movement", label: "Movement", unit: "raw", color: "var(--owlet-movement)", minKey: "movement_min", maxKey: "movement_max", thresholds: [] },
    { key: "battery_percent", label: "Sock battery", unit: "%", color: "var(--owlet-battery)", minKey: "battery_percent", maxKey: "battery_percent", thresholds: [data.settings?.battery_below] },
    { key: "signal", label: "Signal strength", unit: "raw", color: "var(--owlet-signal)", minKey: "signal", maxKey: "signal", thresholds: [] },
  ];
  const selected = !focused ? data.readings.at(-1) : cursor === null ? undefined : data.readings.reduce<OwletGraphPoint | undefined>((best, row) => !best || Math.abs(Date.parse(row.measured_at)-cursor) < Math.abs(Date.parse(best.measured_at)-cursor) ? row : best, undefined);
  const activeSpecs=specs.filter(spec=>focused ? spec.key===focused : overviewMetrics.includes(spec.key));
  const leftAxes=Math.ceil(activeSpecs.length/2),rightAxes=Math.floor(activeSpecs.length/2);
  const plotLeft=focused ? 60 : 70+Math.max(0,leftAxes-1)*50;
  const plotRight=focused ? 705 : 650-Math.max(0,rightAxes-1)*50;
  const bottom=focused ? 445 : 325, plotHeight=focused ? 410 : 290;
  const x=(t:number)=>plotLeft+(t-start)/Math.max(1,end-start)*(plotRight-plotLeft);
  const series=activeSpecs.map(spec=>{
    const key=spec.key as keyof OwletGraphPoint;
    const values=data.readings.flatMap(r=>[r[spec.minKey as keyof OwletGraphPoint],r[spec.maxKey as keyof OwletGraphPoint]]).filter((v):v is number=>typeof v==="number" && Number.isFinite(v) && (!spec.key.match(/heart|oxygen/) || v>0));
    const limits=spec.thresholds.filter((v):v is number=>typeof v==="number");
    const lo=Math.min(...values,...limits,spec.key==="oxygen_percent" ? 90 : spec.key==="signal" ? -100 : 0);
    const hi=Math.max(...values,...limits,spec.key.match(/percent/) ? 100 : spec.key==="heart_rate" ? 180 : spec.key==="signal" ? 0 : 1);
    const scale=graphScale(lo,hi,focused ? 12 : 8);
    const y=(v:number)=>bottom-(v-scale.lo)/(scale.hi-scale.lo)*plotHeight;
    const segments=owletGraphSegments(data,key,x,y);
    return {spec,key,scale,y,segments,limits};
  });
  const inspectPointer=(event:React.PointerEvent<SVGSVGElement>)=>{
    const box=event.currentTarget.getBoundingClientRect();
    inspect(Math.max(start,Math.min(end,start+((event.clientX-box.left)/box.width*720-plotLeft)/(plotRight-plotLeft)*(end-start))));
  };
  return <div className="owlet-graphs">
    {!focused && <div className="owlet-metric-picker" role="group" aria-label="Graph metric">
      {specs.map(spec=><button key={spec.key} aria-pressed={overviewMetrics.includes(spec.key)} onClick={()=>onMetricChange(spec.key)} style={{"--metric-color":spec.color} as React.CSSProperties}>{spec.label}</button>)}
    </div>}
    <p className="muted">{data.bucketSeconds===5 ? "Individual readings" : `${data.bucketSeconds}-second summaries with minimum and maximum whiskers`} · {focused ? "Slide across the graph to inspect a time." : "Choose one or more metrics. Each color has its own scale."}</p>
    <div className="owlet-plot">
      <div className="owlet-series-legend">
        {series.map(({spec,key})=><div key={key} style={{color:spec.color}}><strong>{spec.label}</strong><span>{selected ? `${owletFieldValue(selected[key])} ${spec.unit}` : spec.unit}</span></div>)}
      </div>
      <svg viewBox={`0 0 720 ${focused ? 500 : 355}`} role="img" data-scroll-drag={focused ? "ignore" : undefined} className={focused ? "owlet-scrubbable" : "owlet-overview-chart"} aria-label={`${activeSpecs.map(spec=>`${spec.label} graph`).join(", ")} with ${data.readings.length} time buckets`}
        onPointerDown={event=>{if(!focused)return;event.currentTarget.setPointerCapture(event.pointerId);inspectPointer(event);}}
        onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))inspectPointer(event);}}
        onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onPointerCancel={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}>
        {series.map(({spec,key,scale,y,segments,limits},index)=>{
          const onLeft=focused || index<leftAxes;
          const axisX=onLeft ? plotLeft-8-index*50 : plotRight+8+(index-leftAxes)*50;
          const axisTitle=spec.key==="heart_rate" ? "bpm" : spec.key==="oxygen_percent" ? "O₂ %" : spec.key==="battery_percent" ? "Bat %" : spec.key==="movement" ? "Move" : "Signal";
          return <g key={key} data-metric={spec.key}>
            <text x={axisX} y="14" textAnchor={onLeft ? "end" : "start"} fontSize="18" fill={spec.color}>{axisTitle}</text>
            {scale.ticks.map(v=><g key={v}>
              {index===0 && <line x1={plotLeft} x2={plotRight} y1={y(v)} y2={y(v)} stroke="currentColor" opacity=".1" />}
              <text x={axisX} y={y(v)+4} textAnchor={onLeft ? "end" : "start"} fontSize="22" fill={spec.color}>{v}</text>
            </g>)}
            {limits.map((v,i)=><line key={`level-${i}`} x1={plotLeft} x2={plotRight} y1={y(v)} y2={y(v)} stroke={spec.color} strokeDasharray="5 4"><title>{spec.label} custom level {v} {spec.unit}</title></line>)}
            {data.readings.map((point,i)=>{
              const a=point[spec.minKey as keyof OwletGraphPoint],b=point[spec.maxKey as keyof OwletGraphPoint];
              return typeof a==="number" && typeof b==="number" && (!spec.key.match(/heart|oxygen/) || a>0) ? <line key={i} x1={x(Date.parse(point.measured_at))} x2={x(Date.parse(point.measured_at))} y1={y(a)} y2={y(b)} stroke={spec.color} opacity=".35" /> : null;
            })}
            {segments.map(({d,point},i)=><g key={i}>
              <path d={d} fill="none" stroke={spec.color} strokeWidth="2" data-segment="reading" />
              {point && <circle cx={point.x} cy={point.y} r="4" fill={spec.color} data-point="isolated" />}
            </g>)}
          </g>;
        })}
        {(data.gaps ?? []).map((gap,i)=><rect key={`gap-${i}`} x={x(Date.parse(gap.from))} y={bottom-plotHeight-1} width={Math.max(1,x(Date.parse(gap.to))-x(Date.parse(gap.from)))} height={plotHeight+3} fill="var(--paper)" opacity=".95" data-gap="missing"><title>No saved readings in this gap</title></rect>)}
        {markers.map(a=><line key={a.id} x1={x(a.start)} x2={x(a.start)} y1="15" y2={bottom} stroke={a.kind==="Spasm" ? "#9b456f" : "#718594"} opacity=".35" strokeDasharray="2 4"><title>{a.kind} · {new Date(a.start).toLocaleString()}</title></line>)}
        {data.alerts.map(a=><circle key={a.id} cx={x(Date.parse(a.measured_at))} cy="18" r="4" fill="#ba493d"><title>{owletAlertLabel(a.kind)}</title></circle>)}
        {focused && cursor!==null && cursor>=start && cursor<=end && <line x1={x(cursor)} x2={x(cursor)} y1="15" y2={bottom} stroke="currentColor" strokeDasharray="3 3" />}
        {[start,(start+end)/2,end].map((time,i)=><text key={i} x={x(time)} y={focused ? 480 : 348} textAnchor={i===0 ? "start" : i===2 ? "end" : "middle"} fontSize="22" fill="currentColor">{end-start>86400000 ? new Date(time).toLocaleDateString([], {month:"short",day:"numeric"}) : new Date(time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</text>)}
      </svg>
      {!focused && <div className="owlet-detail-links">{activeSpecs.map(spec=><button key={spec.key} className="owlet-open-details" onClick={()=>{onFocus(spec.key);inspect(data.readings.at(-1) ? Date.parse(data.readings.at(-1)!.measured_at) : end);}}>Open {spec.label.toLowerCase()} details <ChevronRightIcon /></button>)}</div>}
    </div>
    {focused && <div className="owlet-inspector" aria-busy={sampleLoading}>
      <p className="muted">Choose a shorter range to zoom around the inspected time.</p>
      <label>Inspect time<input aria-label="Inspect graph time" type="range" min={start} max={end} step="1" value={cursor ?? end} onChange={(event)=>inspect(Number(event.target.value))} /></label>
      <p className="owlet-inspected">{sampleLoading ? "Inspecting graph interval…" : sample?.reading ? `Nearest saved reading: ${new Date(sample.reading.measured_at).toLocaleString([], {second:"2-digit",minute:"2-digit",hour:"2-digit",year:"numeric",month:"short",day:"numeric"})}` : "Select a time to inspect a saved reading."}</p>
      {sampleLoading && selected && <strong className="owlet-sample-value">{owletFieldValue(selected[focused as keyof OwletGraphPoint])} {specs.find(s=>s.key===focused)?.unit}{data.bucketSeconds>5 ? " · interval average" : ""}</strong>}
      {!sampleLoading && sample?.reading && <strong className="owlet-sample-value">{owletFieldValue(focused === "signal" ? sample.reading.provider_data?.vitals?.rsi : sample.reading[focused as keyof OwletReading])} {specs.find(s=>s.key===focused)?.unit}</strong>}
      {sampleError && <p className="owlet-error">{sampleError}</p>}
      <div className="owlet-actions"><button disabled={sampleLoading || !sample?.previous} onClick={()=>inspect(Date.parse(sample!.previous!))}>← Previous reading</button><button disabled={sampleLoading || !sample?.next} onClick={()=>inspect(Date.parse(sample!.next!))}>Next reading →</button></div>
      {selected && data.bucketSeconds>5 && <p className="muted">Interval minimum: {owletFieldValue(selected[specs.find(s=>s.key===focused)!.minKey as keyof OwletGraphPoint])} · maximum: {owletFieldValue(selected[specs.find(s=>s.key===focused)!.maxKey as keyof OwletGraphPoint])} · average: {owletFieldValue(selected[focused as keyof OwletGraphPoint])}</p>}
      {selected && <p className="muted">{selected.samples} saved reading(s) in this graph interval. {data.bucketSeconds > 5 && `Summary covers ${new Date(selected.first_at).toLocaleString()} to ${new Date(selected.last_at).toLocaleString()}; ${sampleLoading ? "The value above is the interval average while loading an individual reading." : "The value above is an individual saved reading."}`}</p>}
    </div>}
    <p className="muted">Dotted markers: feeding, sleep and spasms. Red dots: custom alerts. Empty sections mean missing data or no signal.</p>
    {!focused && <details className="owlet-reading-details"><summary>Sock status timelines</summary>{(["sleep_state","sock_connection","charging"] as const).map((key) => <div className="owlet-status-strip" key={key}>
      <small>{key === "sleep_state" ? "Sleep state (provider code)" : key === "sock_connection" ? "Sock connection (provider code)" : "Charging"}</small>
      <svg viewBox="0 0 720 22" role="img" aria-label={`${key} timeline`}>
        {data.readings.map((p,i) => {
          const t=Date.parse(p.measured_at), next=Math.min(end,Date.parse(p.last_at)+Math.max(90000,data.bucketSeconds*1000),data.readings[i+1] ? Date.parse(data.readings[i+1].measured_at) : end);
          const v=p[key]; if (v === null) return null;
          return <rect key={i} x={x(t)} y="2" width={Math.max(1,x(next)-x(t))} height="18" fill={["#b7cdd2","#607f8b","#caa778","#847396"][Math.abs(Number(v))%4]}><title>{new Date(t).toLocaleString()} · {String(v)}</title></rect>;
        })}
      </svg>
    </div>)}</details>}
  </div>;
});
function OwletStandby({ name, connection, data, hours, now, error, onRange, onExit, onDetails }: {
  name:string; connection:OwletConnection|undefined; data:OwletHistoryData|null; hours:number; now:number; error:string;
  onRange:(hours:number)=>void; onExit:()=>void; onDetails:(metric:string,time:number|null)=>void;
}) {
  const [cursor,setCursor]=useState<number|null>(null);
  const [visible,setVisible]=useState({heart:true,oxygen:true});
  const [awake,setAwake]=useState(false);
  useEffect(()=>{
    let active=true,pending=false,lock:WakeLockSentinel|null=null;
    const acquire=async()=>{
      if(!active || pending || document.hidden || !("wakeLock" in navigator) || (lock && !lock.released))return;
      pending=true;
      try {
        const next=await navigator.wakeLock.request("screen");
        if(!active){await next.release();return;}
        lock=next;setAwake(!next.released);
        next.addEventListener("release",()=>{if(active)setAwake(false);});
      } catch {if(active)setAwake(false);}
      finally {pending=false;}
    };
    void acquire();document.addEventListener("visibilitychange",acquire);
    return()=>{active=false;document.removeEventListener("visibilitychange",acquire);void lock?.release().catch(()=>{});};
  },[]);
  const measured=connection?.measured_at ? Date.parse(connection.measured_at) : NaN;
  const seconds=Number.isFinite(measured) ? Math.max(0,Math.floor((now-measured)/1000)) : null;
  const stale=seconds===null || seconds>30;
  const value=(n:number|null|undefined)=>typeof n==='number' && Number.isFinite(n) && n>0 ? Math.round(n) : '—';
  const start=data ? Date.parse(data.from) : now-hours*3600000, end=data ? Date.parse(data.to) : now;
  const x=(t:number)=>48+(t-start)/Math.max(1,end-start)*904;
  const heartTop=Math.max(180,...(data?.readings ?? []).map(p=>p.heart_max ?? p.heart_rate ?? 0));
  const oxygenBottom=Math.min(90,...(data?.readings ?? []).map(p=>p.oxygen_min ?? p.oxygen_percent ?? 90).filter(v=>v>0));
  const heartScale=graphScale(0,heartTop);
  const oxygenScale=graphScale(oxygenBottom,100);
  const y=(v:number,oxygen:boolean)=>{const scale=oxygen?oxygenScale:heartScale;return 156-(v-scale.lo)/(scale.hi-scale.lo)*140;};
  const selected=cursor===null ? null : data?.readings.reduce<OwletGraphPoint|null>((best,row)=>!best || Math.abs(Date.parse(row.measured_at)-cursor)<Math.abs(Date.parse(best.measured_at)-cursor) ? row : best,null);
  const inspect=(event:React.PointerEvent<SVGSVGElement>)=>{const box=event.currentTarget.getBoundingClientRect();setCursor(Math.max(start,Math.min(end,start+((event.clientX-box.left)/box.width*1000-48)/904*(end-start))));};
  return <div className="owlet-standby">
    <header className="standby-header"><div><h2>{name}</h2><span>Owlet Dream Sock</span></div><button onClick={onExit}><Cross2Icon /> Exit</button></header>
    <div className="standby-readings">
      <button onClick={()=>onDetails('heart_rate',null)} aria-label="Open heart rate details"><div><HeartIcon className="standby-heart"/><strong>{value(connection?.heart_rate)}</strong><span>bpm</span></div><small>Heart rate</small></button>
      <button onClick={()=>onDetails('oxygen_percent',null)} aria-label="Open oxygen details"><div><span className="standby-oxygen" aria-hidden="true">O<sub>2</sub></span><strong>{value(connection?.oxygen_percent)}</strong><span>%</span></div><small>Oxygen</small></button>
    </div>
    <div className="standby-trends">
      <div className="standby-toolbar"><div><button aria-pressed={visible.heart} onClick={()=>setVisible(v=>({...v,heart:!v.heart}))}><HeartIcon /> Heart rate (bpm)</button><button aria-pressed={visible.oxygen} onClick={()=>setVisible(v=>({...v,oxygen:!v.oxygen}))}><span>O₂</span> Oxygen (%)</button></div><Select aria-label="Standby graph range" value={hours} onValueChange={v=>{setCursor(null);onRange(Number(v));}}>{owletRanges.map(([h,label])=><option key={h} value={h}>{label}</option>)}</Select></div>
      {error && <p className="owlet-error" role="status">{error}</p>}
      {!data ? <p className="standby-empty">{connection?"Loading graph history…":"Connect a sock in Settings to see saved readings."}</p> : !data.readings.length ? <p className="standby-empty">No saved readings in this window.</p> : <svg className="standby-chart" viewBox="0 0 1000 192" preserveAspectRatio="none" role="img" aria-label="Heart rate and oxygen trends. Drag to inspect readings." data-scroll-drag="ignore" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);inspect(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))inspect(e);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}>
        {[false,true].map(oxygen=>(oxygen?visible.oxygen:visible.heart) && <g key={`axis-${oxygen}`}>
          {(oxygen?oxygenScale:heartScale).ticks.map(v=><g key={v}>
            <line x1="48" x2="952" y1={y(v,oxygen)} y2={y(v,oxygen)} stroke={oxygen?'var(--owlet-oxygen)':'var(--line)'} opacity={oxygen && visible.heart ? .12 : .5} strokeDasharray="4 4"/>
            <text x={oxygen?962:38} y={y(v,oxygen)+5} textAnchor={oxygen?'start':'end'} fill={oxygen?'var(--owlet-oxygen)':'var(--owlet-heart)'}>{v}</text>
          </g>)}
        </g>)}
        {[false,true].map(oxygen=>(oxygen?visible.oxygen:visible.heart) && <g key={String(oxygen)} data-metric={oxygen?'oxygen_percent':'heart_rate'}>{owletGraphSegments(data,oxygen?'oxygen_percent':'heart_rate',x,v=>y(v,oxygen)).map(({d,point},i)=><g key={i}>
          <path d={d} fill="none" stroke={oxygen?'var(--owlet-oxygen)':'var(--owlet-heart)'} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          {point && <circle cx={point.x} cy={point.y} r="4" fill={oxygen?'var(--owlet-oxygen)':'var(--owlet-heart)'} data-point="isolated"/>}
        </g>)}{data.readings.map((p,i)=>{const lo=oxygen?p.oxygen_min:p.heart_min,hi=oxygen?p.oxygen_max:p.heart_max;return lo!==null && hi!==null && lo>0 ? <line key={i} x1={x(Date.parse(p.measured_at))} x2={x(Date.parse(p.measured_at))} y1={y(lo,oxygen)} y2={y(hi,oxygen)} stroke={oxygen?'var(--owlet-oxygen)':'var(--owlet-heart)'} opacity=".25"/>:null;})}</g>)}
        {data.gaps.map((g,i)=><rect key={i} x={x(Date.parse(g.from))} y="14" width={Math.max(1,x(Date.parse(g.to))-x(Date.parse(g.from)))} height="144" fill="var(--paper)"><title>No saved readings</title></rect>)}
        {[false,true].map(oxygen=>{const p=data.readings.at(-1),v=oxygen?p?.oxygen_percent:p?.heart_rate;return p && typeof v==='number' && v>0 && (oxygen?visible.oxygen:visible.heart) ? <circle key={String(oxygen)} cx={x(Date.parse(p.measured_at))} cy={y(v,oxygen)} r="4" fill={oxygen?'var(--owlet-oxygen)':'var(--owlet-heart)'}/>:null;})}
        {cursor!==null && cursor>=start && cursor<=end && <line x1={x(cursor)} x2={x(cursor)} y1="14" y2="158" stroke="var(--muted)" strokeDasharray="3 3"/>}
        {[start,(start+end)/2,end].map((t,i)=><text key={i} x={x(t)} y="184" textAnchor={i===0?'start':i===2?'end':'middle'} fill="var(--muted)">{end-start>86400000?new Date(t).toLocaleDateString([],{month:'short',day:'numeric'}):new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</text>)}
      </svg>}
      <div className="standby-inspection">{selected ? <><span>{new Date(selected.measured_at).toLocaleTimeString()} · {value(selected.heart_rate)} bpm · {value(selected.oxygen_percent)}%{data && data.bucketSeconds>5?' · interval averages':''}</span><button onClick={()=>onDetails(visible.heart?'heart_rate':'oxygen_percent',cursor)}>Inspect saved reading</button><button onClick={()=>setCursor(null)}>Live</button></> : <span>Drag across the graph to inspect · Tap a reading for details</span>}</div>
    </div>
    <footer className="standby-footer"><span><BatteryHighIcon /> {connection?.battery_percent ?? '—'}% <small>Sock battery</small></span><span className={stale?'standby-stale':''}>{seconds===null?'Waiting for a reading':`Last reading ${seconds<60?`${seconds} seconds`:`${Math.floor(seconds/60)} minutes`} ago`}{stale && seconds!==null?' · Stale':''}</span><small>Refresh target: 5 seconds · {awake?"Screen awake":"Screen may sleep"}</small></footer>
    {(!connection || connection.last_error || !navigator.onLine) && <p className="standby-status" role="status">{!connection?'No sock connected for this child. Connect one in Settings.':!navigator.onLine?'Offline · Showing last known readings.':`Collection needs attention: ${connection.last_error}`}</p>}
  </div>;
}
const emptyOwletAlertFields: OwletAlertFields = { oxygenBelow: "", heartBelow: "", heartAbove: "", batteryBelow: "" };
const owletFieldNames: Record<string, string> = {
  ox: "Oxygen saturation", hr: "Heart rate", bat: "Sock battery", btt: "Battery minutes",
  rsi: "Signal strength", oxta: "Oxygen average", bso: "Base station on",
  sc: "Sock connection", st: "Skin temperature", ss: "Sleep state", mv: "Movement",
  aps: "Alert paused", chg: "Charging", alrt: "Alerts mask", ota: "Update status",
  srf: "Readings flag", sb: "Sensor status", mvb: "Movement bucket", onm: "Wellness alert",
  mst: "Monitoring start time", bsb: "Base battery status", hw: "Hardware version",
  HEART_RATE: "Heart rate", OXYGEN_LEVEL: "Oxygen saturation", BATT_LEVEL: "Sock battery",
  MOVEMENT: "Movement", SOCK_CONNECTION: "Sock connection", CHARGE_STATUS: "Charging",
};
function owletFieldLabel(key: string) {
  return owletFieldNames[key] ?? key.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
function owletFieldValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { /* Show the source value. */ }
  }
  return String(value);
}
function owletAlertLabel(kind: string) {
  return ({ oxygen_below: "Oxygen below", heart_below: "Heart rate below",
    heart_above: "Heart rate above", battery_below: "Sock battery below" } as Record<string, string>)[kind] ?? kind;
}
const defaultQuickActions: Kind[] = [
  "Feed", "Sleep", "Nursing", "Pumping", "Spasm", "Diaper",
];
function validQuickActions(value: unknown): value is Kind[] {
  return Array.isArray(value) &&
    value.length <= kinds.length &&
    value.every((action) => kinds.includes(action)) &&
    new Set(value).size === value.length;
}
function quickActionsKey() {
  return `baby-quick-actions:${identity?.user.id ?? "preview"}`;
}
function loadQuickActions(): Kind[] {
  try {
    const stored = JSON.parse(localStorage.getItem(quickActionsKey()) ?? "null");
    if (stored?.pending && validQuickActions(stored.actions)) return stored.actions;
    if (!identity && validQuickActions(stored?.actions)) return stored.actions;
  } catch { /* Use the saved account choice or default. */ }
  return validQuickActions(identity?.quickActions)
    ? identity.quickActions
    : defaultQuickActions;
}
const activityIcons = {
  Feed: DropIcon, Diaper: BabyIcon, Sleep: MoonIcon, Nursing: HeartIcon,
  Pumping: DropIcon, Solids: BowlFoodIcon, Growth: RulerIcon,
  Medication: PillIcon, Milestone: StarIcon, Routine: BookOpenIcon,
  Pregnancy: BabyIcon, Postpartum: FlowerIcon, Spasm: ClockIcon,
};
function Mark({ kind }: { kind: Kind }) {
  const Icon = activityIcons[kind];
  return (
    <span className={`mark ${kind.toLowerCase()}`}>
      <Icon />
    </span>
  );
}
function relative(t: number) {
  const n = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return n < 1
    ? "Just now"
    : n < 60
      ? `${n} min ago`
      : `${Math.floor(n / 60)}h ${n % 60}m ago`;
}
function download(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadBase64(content: string, type: string, name: string) {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function OfflineStorage() {
  const [storage, setStorage] = useState(offlineStorageStatus);
  useEffect(() => {
    const changed = () => setStorage(offlineStorageStatus);
    window.addEventListener("baby:storage", changed);
    void checkOfflineStorage();
    return () => window.removeEventListener("baby:storage", changed);
  }, []);
  const used = storage.usage === undefined ? null : Math.ceil(storage.usage / 1024 / 1024);
  return <section className="offline-storage" aria-label="Offline storage">
    <h3>Offline storage</h3>
    <p role="status">{storage.state === "checking" ? "Checking device storage…"
      : storage.state === "persistent" ? "Offline storage is protected from automatic browser cleanup."
      : storage.state === "best-effort" ? "Records save on this device. iOS has not granted storage protection."
      : "Records save on this device. Storage protection is unavailable in this browser."}</p>
    {used !== null && <p className="muted">Device storage used: {used} MB.</p>}
    <p className="muted">Saved entries upload automatically when connected while the app is open, or when you return to it. Keep the app open until Synced. Your device can still remove data if you clear its website storage.</p>
  </section>;
}

type RecentNotification = {
  id: string; source: "owlet" | "timer" | "test"; alert_id?: string;
  child_name?: string; kind: string; measured_value?: number; threshold_value?: number;
  created_at: string; measured_at?: string; acknowledged_at?: string;
  status: "active" | "paused" | "accepted" | "sent"; title?: string; body?: string; url: string;
};
function DeviceNotifications({ status, onStatus }: { status: DevicePushStatus; onStatus: (value: DevicePushStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function run(test: boolean) {
    setBusy(true); setMessage("");
    void (test ? testPush() : enablePush())
      .then(() => {
        setMessage(test ? "Test notification sent. Check this device’s Notification Center." : "Notifications enabled on this device.");
        window.dispatchEvent(new Event("baby:notification-change"));
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => { setBusy(false); void reconcilePushRegistration().then(onStatus).catch(() => {}); });
  }
  const enabled = status.state === "enabled";
  const blocked = status.state === "blocked" || status.state === "unavailable";
  return <div className="device-notifications">
    <p className="muted" role="status">{status.message}</p>
    {!enabled && <button className="primary" disabled={busy || blocked} onClick={() => run(false)}>
      <BellIcon /> {busy ? "Setting up notifications…" : "Enable notifications on this device"}
    </button>}
    <button className="more-action" disabled={busy || !enabled} onClick={() => run(true)}><BellIcon />{busy && enabled ? "Sending test…" : "Send test notification"}</button>
    {message && <p className="device-notification-result" role="status">{message}</p>}
  </div>;
}
export default function Prototype() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Today");
  const [sheet, setSheet] = useState("");
  const [notificationOptions, setNotificationOptions] = useState(notificationPreferences);
  const [pushStatus, setPushStatus] = useState<DevicePushStatus>({ state: "checking", message: "Checking notification connection…" });
  const [soundReady, setSoundReady] = useState(alertSoundReady);
  const [alertConnection, setAlertConnection] = useState<"checking" | "connected" | "error">("checking");
  const reportAlertConnection = useCallback((status: "connected" | "error") => setAlertConnection(status), []);
  const [recentNotifications, setRecentNotifications] = useState<RecentNotification[]>([]);
  const [notificationHistoryError, setNotificationHistoryError] = useState("");
  const [notificationHistoryLoaded, setNotificationHistoryLoaded] = useState(false);
  const [acceptingNotification, setAcceptingNotification] = useState<string | null>(null);
  const notificationHistoryPending = useRef(false);
  const notificationHistoryRequested = useRef(false);
  const notificationHistoryRevision = useRef(0);
  const notificationHistoryKey = `baby-notification-history-v1:${identity?.user.id ?? "preview"}:${familyId}`;
  const loadNotificationHistory = useCallback(async () => {
    if (!identity || !familyId || document.hidden) return;
    if (notificationHistoryPending.current) { notificationHistoryRequested.current = true; return; }
    notificationHistoryPending.current = true;
    const user = identity.user.id, household = familyId, revision = notificationHistoryRevision.current;
    try {
      const result = await api(`/notifications?family=${encodeURIComponent(familyId)}`);
      if (identity?.user.id !== user || familyId !== household || revision !== notificationHistoryRevision.current) return;
      const events: RecentNotification[] = Array.isArray(result.events) ? result.events : [];
      setRecentNotifications(events); setNotificationHistoryError(""); setNotificationHistoryLoaded(true);
    } catch {
      setNotificationHistoryError("Notification history is unavailable. Showing saved history; retrying automatically.");
    } finally {
      notificationHistoryPending.current = false;
      if (notificationHistoryRequested.current) { notificationHistoryRequested.current = false; void loadNotificationHistory(); }
    }
  }, [notificationHistoryKey]);
  useEffect(() => {
    const changed = () => setNotificationOptions(notificationPreferences());
    const soundChanged = () => setSoundReady(alertSoundReady());
    window.addEventListener(notificationPreferencesEvent, changed);
    window.addEventListener(soundEvent, soundChanged);
    window.addEventListener("storage", notificationPreferencesChanged);
    const stopSound = watchAlertSound();
    return () => { stopSound(); window.removeEventListener(notificationPreferencesEvent, changed); window.removeEventListener(soundEvent, soundChanged); window.removeEventListener("storage", notificationPreferencesChanged); };
  }, []);
  useEffect(() => {
    if (!identity) return;
    return watchPushRegistration(setPushStatus);
  }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationHistoryKey) ?? "[]");
      if (Array.isArray(stored)) {
        setRecentNotifications(stored.filter(event => event && typeof event.id === "string" && typeof event.created_at === "string").slice(0,100));
        if (stored.length) setNotificationHistoryLoaded(true);
      }
    } catch { /* Fetch fresh history. */ }
    const refresh = () => void loadNotificationHistory();
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const accepted = () => { notificationHistoryRevision.current++; refresh(); };
    window.addEventListener("baby:notification-accepted", accepted); window.addEventListener("baby:notification-change", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("baby:notification-accepted", accepted); window.removeEventListener("baby:notification-change", refresh); };
  }, [loadNotificationHistory]);
  useEffect(() => {
    if (!notificationHistoryLoaded) return;
    try { localStorage.setItem(notificationHistoryKey, JSON.stringify(recentNotifications)); } catch { /* Keep session history. */ }
  }, [recentNotifications,notificationHistoryLoaded,notificationHistoryKey]);
  useEffect(() => { if (sheet === "notificationInbox" || sheet === "notifications") void loadNotificationHistory(); }, [sheet, loadNotificationHistory]);
  async function acceptNotification(event: RecentNotification) {
    if (!event.alert_id || acceptingNotification) return;
    setAcceptingNotification(event.id);
    try {
      const result = await api("/owlet/accept-alert", { family: familyId, eventId: event.alert_id });
      void setAlertBadge(result.badgeCount); void refreshAlertBadge();
      notificationHistoryRevision.current++;
      setRecentNotifications(events => events.map(row => row.id === event.id ? { ...row, status: "accepted", acknowledged_at: result.acknowledged_at } : row));
      window.dispatchEvent(new CustomEvent("baby:notification-accepted", { detail: event.alert_id }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not accept this alert. It remains active."); }
    finally { setAcceptingNotification(null); }
  }

  const [removingMember,setRemovingMember] = useState<{id:string;name:string}|null>(null);
  const [memberBusy,setMemberBusy] = useState(false);
  const [kind, setKind] = useState<Kind>("Feed");
  const [edit, setEdit] = useState<Activity | null>(null);
  const [detail, setDetail] = useState("Breast milk");
  const [amount, setAmount] = useState("120");
  const [notes, setNotes] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [childEdit, setChildEdit] = useState("");
  const [sex, setSex] = useState("Not specified");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [lastDeleted, setLastDeleted] = useState("");
  const [filter, setFilter] = useState("All");
  const [date, setDate] = useState(todayKey(Date.now()));
  const [period, setPeriod] = useState(7);
  const [metric, setMetric] = useState("Sleep");
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [quickActions, setQuickActions] = useState<Kind[]>(loadQuickActions);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(syncStatus);
  const [inviteURL, setInviteURL] = useState("");
  const [members, setMembers] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [naraPreviews, setNaraPreviews] = useState<NaraPreview[]>([]);
  const [naraTargets, setNaraTargets] = useState<Record<string, string>>({});
  const [unassignedPumpTarget, setUnassignedPumpTarget] = useState("");
  const [naraImporting, setNaraImporting] = useState(false);
  const [owletStatus, setOwletStatus] = useState<OwletStatus | null>(null);
  const owletChildId = state?.selected ?? "";
  const owletDemo = !identity && !!state?.demo;
  const [owletOverviewMetrics,setOwletOverviewMetrics]=useState<string[]>(["heart_rate","oxygen_percent"]);
  const toggleOwletOverviewMetric=useCallback((metric:string)=>{
    setOwletOverviewMetrics(current=>{
      if(!current.includes(metric))return [...current,metric];
      return current.length>1 ? current.filter(key=>key!==metric) : current;
    });
  },[]);
  const [owletFocusedMetric, setOwletFocusedMetric] = useState<string | null>(null);
  const owletInspectionTime = useRef<number|null>(null);
  const [owletEmail, setOwletEmail] = useState("");
  const [owletPassword, setOwletPassword] = useState("");
  const [owletBusy, setOwletBusy] = useState(false);
  const [owletDevices, setOwletDevices] = useState<{ serial: string; name: string; model: string }[]>([]);
  const [owletReadings, setOwletReadings] = useState<OwletReading[]>([]);
  const [owletAlertFields, setOwletAlertFields] = useState<OwletAlertFields>(emptyOwletAlertFields);
  const [owletRepeatUntilAccepted, setOwletRepeatUntilAccepted] = useState(true);
  const [owletAlertSettingsLoaded, setOwletAlertSettingsLoaded] = useState(false);
  const [owletHistorySnapshot, setOwletHistoryData] = useState<(OwletHistoryData & {childId:string;hours:number;windowEnd:number|null}) | null>(null);
  const [owletGraphHours, setOwletGraphHours] = useState(6);
  const [owletGraphEnd, setOwletGraphEnd] = useState<number | null>(null);
  const demoHistory = useMemo(()=>owletDemo ? demoOwletHistory(owletGraphEnd ?? Math.floor(now/5000)*5000,owletGraphHours) : null,[owletDemo,owletGraphEnd,owletGraphHours,Math.floor(now/5000)]);
  const owletHistoryData = demoHistory ?? (owletHistorySnapshot?.childId === owletChildId &&
    owletHistorySnapshot.hours === owletGraphHours && owletHistorySnapshot.windowEnd === owletGraphEnd
    ? owletHistorySnapshot : null);
  const [owletHistoryError, setOwletHistoryError] = useState("");
  const [owletBefore, setOwletBefore] = useState<string | null>(null);
  const [owletNextBefore, setOwletNextBefore] = useState<string | null>(null);
  const [owletExportDataset, setOwletExportDataset] = useState("readings");
  const [owletExportFormat, setOwletExportFormat] = useState("jsonl");
  const [owletPollDetails, setOwletPollDetails] = useState<{childId:string;text:string} | null>(null);
  useEffect(() => {
    setOwletBefore(null);setOwletNextBefore(null);setOwletDevices([]);setOwletPollDetails(null);
    setOwletOverviewMetrics(["heart_rate","oxygen_percent"]);setOwletFocusedMetric(null);setOwletPassword("");owletInspectionTime.current=null;
  },[owletChildId]);
  useEffect(() => {if(state)applyBabyTheme(state.theme);},[state?.theme]);
  useEffect(() => {
    load()
      .then((s) => {
        const url = new URL(location.href);
        const alertChild = url.searchParams.get("owletAlert") && url.searchParams.get("child");
        if (alertChild && s.children.some(child=>child.id===alertChild)) s={...s,selected:alertChild};
        const linked = s.activities.find((a) => a.id === url.searchParams.get("timer") && !a.deleted);
        if (linked) {
          if (linked.childId) s = { ...s, selected: linked.childId };
          populateEntry(linked.kind, linked);
          url.searchParams.delete("timer");
          history.replaceState(null, "", url);
        }
        setState(s);
        setReady(true);
        if (!identity) void persist(s);
        setSaved(true);
      })
      .catch(() =>
        setMessage(
          "Could not open device storage. Please reload before logging.",
        ),
      );
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const cloud = (e: Event) => setState((e as CustomEvent<State>).detail);
    const status = () => setCloudStatus(syncStatus);
    window.addEventListener("baby:cloud", cloud);
    window.addEventListener("baby:status", status);
    if (identity)
      api("/families/" + familyId)
        .then((v) => setMembers(v.members))
        .catch(() => {});
    return () => {
      window.removeEventListener("baby:cloud", cloud);
      window.removeEventListener("baby:status", status);
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (!identity) return;
    const key = quickActionsKey();
    const savePending = async () => {
      if (!navigator.onLine) return;
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? "null");
        if (!stored?.pending || !validQuickActions(stored.actions)) return;
        const actions: Kind[] = stored.actions;
        await api("/quick-actions", { actions });
        const latest = JSON.parse(localStorage.getItem(key) ?? "null");
        if (latest?.pending && JSON.stringify(latest.actions) === JSON.stringify(actions)) {
          localStorage.setItem(key, JSON.stringify({ actions, pending: false }));
          identity!.quickActions = actions;
          localStorage.setItem("baby-last-identity", JSON.stringify(identity));
        }
      } catch {
        setMessage("Quick actions are saved here and will sync when connected.");
      }
    };
    const timer = setTimeout(() => void savePending(), 400);
    const onOnline = () => void savePending();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [quickActions]);
  useEffect(() => {
    if (!identity || !familyId) return;
    let mounted = true;
    let pending = false;
    const loadStatus = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { const result = await api(`/owlet?family=${encodeURIComponent(familyId)}`); if (mounted) setOwletStatus(result); }
      catch { /* Keep the last known status visible. */ }
      finally { pending = false; }
    };
    // Clients share the collector's readings; refresh the bedside values more
    // often so opening two devices at different times does not add a 5s lag.
    const interval=sheet === "owletStandby" ? 1000 : 5000;
    const stop=pollOwletInForeground(loadStatus,interval);
    return () => { mounted = false; stop(); };
  }, [sheet === "owletStandby"]);
  useEffect(() => {
    if (sheet !== "owletLogs" || !identity || !owletChildId) return;
    let current = true;
    let pending = false;
    setOwletReadings([]);
    setOwletNextBefore(null);
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await api(`/owlet/readings?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(owletChildId)}${owletBefore ? `&before=${encodeURIComponent(owletBefore)}` : ""}`);
        if (current) { setOwletReadings(result.readings); setOwletNextBefore(result.before); }
      } catch { /* Retain the current page on transient failures. */ }
      finally { pending = false; }
    };
    void load();
    const timer = owletBefore ? null : setInterval(() => void load(),5000);
    return () => { current = false; if (timer) clearInterval(timer); };
  }, [sheet, owletChildId, owletBefore]);
  useEffect(() => {
    if (!["owlet","owletLogs","owletStandby"].includes(sheet) || !identity || !owletChildId) return;
    let current = true, pending = false;
    setOwletHistoryError("");
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const end = owletGraphEnd ?? Date.now();
      try {
        const result = await api(`/owlet/history?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(owletChildId)}&from=${new Date(end-owletGraphHours*3600000).toISOString()}&to=${new Date(end).toISOString()}`);
        if (current) { setOwletHistoryData({...result,childId:owletChildId,hours:owletGraphHours,windowEnd:owletGraphEnd}); setOwletHistoryError(""); }
      } catch (error) { if (current) setOwletHistoryError(error instanceof Error ? error.message : "Graph history unavailable"); }
      finally { pending = false; }
    };
    const stop=pollOwletInForeground(load,owletGraphEnd === null ? 5000 : null);
    return () => { current = false; stop(); };
  }, [sheet, owletChildId, owletGraphHours, owletGraphEnd]);
  useEffect(() => {
    if (!["owletAlerts", "notifications"].includes(sheet) || !identity || !owletChildId) return;
    let current = true, pending = false, settingsLoaded = false;
    setOwletAlertFields(emptyOwletAlertFields);
    setOwletRepeatUntilAccepted(true);setOwletAlertSettingsLoaded(false);
    const load = (includeSettings: boolean) => {
      if (pending) return;
      pending = true;
      return api(`/owlet/alerts?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(owletChildId)}`)
      .then((result) => {
        if (!current) return;
        if (includeSettings) {
          setOwletRepeatUntilAccepted(result.settings?.repeat_until_accepted ?? true);
          setOwletAlertSettingsLoaded(true);settingsLoaded=true;
          setOwletAlertFields({
          oxygenBelow: String(result.settings?.oxygen_below ?? ""),
          heartBelow: String(result.settings?.heart_below ?? ""),
          heartAbove: String(result.settings?.heart_above ?? ""),
          batteryBelow: String(result.settings?.battery_below ?? ""),
        });
        }
      }).catch(() => {}).finally(() => { pending = false; });
    };
    void load(true);
    const timer = setInterval(() => { if (!document.hidden) void load(sheet === "notifications" || !settingsLoaded); }, 5000);
    return () => { current = false; clearInterval(timer); };
  }, [sheet, owletChildId]);
  function changeQuickActions(actions: Kind[]) {
    try {
      localStorage.setItem(
        quickActionsKey(),
        JSON.stringify({ actions, pending: !!identity }),
      );
    } catch {
      setMessage("Could not save quick actions on this device.");
    }
    setQuickActions(actions);
  }
  async function loadOwletStatus() {
    if (!identity || !familyId) return;
    try {
      setOwletStatus(await api(`/owlet?family=${encodeURIComponent(familyId)}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Owlet data.");
    }
  }
  function openOwlet(view = "owlet") {
    setOwletDevices([]);
    owletInspectionTime.current=null;
    setOwletFocusedMetric(null);
    setOwletEmail("");
    setOwletPassword("");
    setOwletBefore(null);
    setOwletGraphEnd(null);
    setOwletPollDetails(null);
    setSheet(view);
  }
  async function linkOwlet() {
    if (!owletChildId || !owletEmail || !owletPassword || owletBusy) return;
    setOwletBusy(true);
    try {
      const result = await api("/owlet/connect", {
        family: familyId, childId: owletChildId,
        email: owletEmail, password: owletPassword,
      });
      setOwletDevices(result.devices);
      setOwletEmail("");
      setMessage(`Connected ${result.device.name}. Collection will begin shortly.`);
      await loadOwletStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect Owlet.");
    } finally {
      setOwletPassword("");
      setOwletBusy(false);
    }
  }
  async function chooseOwletDevice(serial: string) {
    setOwletBusy(true);
    try {
      await api("/owlet/device", { family: familyId, childId: owletChildId, serial });
      await loadOwletStatus();
      setMessage("Owlet device updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change Owlet device.");
    } finally { setOwletBusy(false); }
  }
  async function loadOwletDevices() {
    setOwletBusy(true);
    try {
      const result = await api("/owlet/devices", { family: familyId, childId: owletChildId });
      setOwletDevices(result.devices);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not list Owlet devices.");
    } finally { setOwletBusy(false); }
  }
  async function refreshOwlet() {
    setOwletBusy(true);
    try {
      await api("/owlet/refresh", { family: familyId, childId: owletChildId });
      setMessage("Owlet refresh queued. New readings may take a moment.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh Owlet.");
    } finally { setOwletBusy(false); }
  }
  async function disconnectOwlet() {
    setOwletBusy(true);
    try {
      await api("/owlet/disconnect", { family: familyId, childId: owletChildId });
      setOwletDevices([]);
      await loadOwletStatus();
      setMessage("Owlet disconnected. Saved readings remain in this household.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect Owlet.");
    } finally { setOwletBusy(false); }
  }
  async function saveOwletAlerts() {
    const fields = Object.values(owletAlertFields);
    if (fields.some((value) => value !== "" && !/^\d+$/.test(value))) {
      setMessage("Use whole numbers for Owlet alerts, or leave a field blank to turn it off.");
      return;
    }
    setOwletBusy(true);
    try {
      await api("/owlet/alerts", {
        family: familyId, childId: owletChildId,
        oxygenBelow: owletAlertFields.oxygenBelow === "" ? null : Number(owletAlertFields.oxygenBelow),
        heartBelow: owletAlertFields.heartBelow === "" ? null : Number(owletAlertFields.heartBelow),
        heartAbove: owletAlertFields.heartAbove === "" ? null : Number(owletAlertFields.heartAbove),
        batteryBelow: owletAlertFields.batteryBelow === "" ? null : Number(owletAlertFields.batteryBelow),
        repeatUntilAccepted: owletRepeatUntilAccepted,
      });
      setMessage("Owlet alert levels saved for this child. Each caregiver can enable phone notifications on their device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save Owlet alerts.");
    } finally { setOwletBusy(false); }
  }
  const localTime = (t: number) => {
    const d = new Date(t);
    return new Date(t - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);
  };
  function populateEntry(k: Kind, a?: Activity) {
    setExtra(
      (a as Activity & { fields?: Record<string, string> })?.fields ?? {},
    );
    setKind(k);
    setEdit(a ?? null);
    setDetail(
      a?.detail ?? (k === "Diaper" ? "Wet" : k === "Feed" ? "Breast milk" : ""),
    );
    setAmount(String(a?.amount ?? (k === "Pumping" ? "" : 120)));
    setNotes(a?.notes ?? "");
    setStart(localTime(a?.start ?? Date.now()));
    setEnd(a?.end ? localTime(a.end) : "");
    setSheet("log");
  }
  if (!state)
    return (
      <MobileScroll className="baby-app">
        <main className="baby-content">
          <h1>
            Did I Feed
            <br />
            My Baby?
          </h1>
          <p>{message || "Opening your day…"}</p>
        </main>
      </MobileScroll>
    );
  const child = state.children.find((c) => c.id === state.selected) ?? {
    id: "",
    name: "Your child",
    birthDate: todayKey(Date.now()),
    sex: "",
  };
  const demoPoint=demoHistory?.readings.at(-1);
  const demoConnection: OwletConnection | undefined=demoPoint ? {
    ...demoPoint,child_id:owletChildId,device_serial:"demo",device_name:"Demo Dream Sock",account_email:"",
    alerts:{},last_polled_at:demoPoint.measured_at,last_error:null,latest_alert_at:null,latest_alert_kind:null,
    next_poll_at:new Date(now+5000).toISOString(),failure_count:0,last_duration_ms:120,
  } : undefined;
  const currentOwlet = demoConnection ?? owletStatus?.connections.find((item) => item.child_id === child.id);
  const selectedOwlet = demoConnection ?? owletStatus?.connections.find((item) => item.child_id === owletChildId);
  const events = state.activities
    .filter((a) => a.childId === child.id && !a.deleted)
    .sort((a, b) => b.start - a.start);
  const active = events.find(
    (a) => (a.kind === "Sleep" || a.kind === "Spasm" || a.timer) && !a.end,
  );
  const activeSpasm = events.find((a) => a.kind === "Spasm" && !a.end);
  const todaysSpasms = events.filter(
    (a) => a.kind === "Spasm" && todayKey(a.start) === todayKey(now),
  );
  const lastFeed = events.find(
    (a) => a.kind === "Feed" || a.kind === "Nursing",
  );
  const update = (fn: (s: State) => State) => {
    const next = fn(state);
    setState(next);
    setSaved(false);
    void persist(next)
      .then(() => setSaved(true))
      .catch(() =>
        setMessage(
          "Could not save on this device. Export your records before closing.",
        ),
      );
  };
  function open(k: Kind, a?: Activity) {
    if (!child.id && !["Pregnancy", "Postpartum"].includes(k)) {
      setSheet("addChild");
      return;
    }
    populateEntry(k, a);
  }
  async function chooseNaraFiles(files: FileList | null) {
    const currentState = state;
    if (!currentState) return;
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    if (selected.length > 5) {
      setMessage("Choose up to five Nara CSV files at once.");
      return;
    }
    try {
      const previews: NaraPreview[] = [];
      for (const file of selected) previews.push(await inspectNaraFile(file));
      const used = new Set<string>();
      let newSlots = Math.max(0, 5 - currentState.children.length);
      const targets: Record<string, string> = {};
      for (const preview of previews) {
        const matchingChild = currentState.children.find(
          (candidate) =>
            candidate.name.trim().toLowerCase() ===
              preview.profileName.trim().toLowerCase() &&
            !used.has(candidate.id),
        );
        if (matchingChild) {
          used.add(matchingChild.id);
          targets[preview.sha256] = matchingChild.id;
        } else if (newSlots > 0) {
          newSlots -= 1;
          targets[preview.sha256] = "new";
        } else targets[preview.sha256] = "";
      }
      setNaraPreviews(previews);
      setNaraTargets(targets);
      setUnassignedPumpTarget("");
      setSheet("naraPreview");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not read the Nara CSV.",
      );
    }
  }
  async function saveNaraImport() {
    if (!state || naraImporting) return;
    setNaraImporting(true);
    try {
      const result = await importNaraFiles(
        naraPreviews,
        naraTargets,
        unassignedPumpTarget,
        state,
      );
      update((current) => ({
        ...current,
        children: result.children,
        activities: result.activities,
        naraImports: result.naraImports,
        selected: result.selectedChildId,
      }));
      setSheet("");
      setNaraPreviews([]);
      setMessage(
        `Imported ${result.importedCount} records. ${result.duplicateCount} duplicate records were merged.${result.archivedOnlyCount ? ` ${result.archivedOnlyCount} unassigned Pump records remain in the preserved Nara files.` : ""}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nara import failed.");
    } finally {
      setNaraImporting(false);
    }
  }
  async function downloadNaraExport(childId: string) {
    if (!state) return;
    const target = state.children.find((candidate) => candidate.id === childId);
    if (!target) return;
    try {
      const csv = await exportNaraCSV(state, childId);
      const filePart = target.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      download(
        csv,
        "text/csv;charset=utf-8",
        `${filePart || "baby"}-nara-export.csv`,
      );
      setMessage(`Downloaded the Nara-format CSV for ${target.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not export Nara CSV.",
      );
    }
  }
  function startSpasm() {
    if (!child.id) {
      setSheet("addChild");
      return;
    }
    if (active) {
      setMessage(`Stop the ${active.kind.toLowerCase()} timer before starting another.`);
      return;
    }
    const episode: Activity = {
      id: crypto.randomUUID(),
      childId: child.id,
      kind: "Spasm",
      start: Date.now(),
      detail: "Spasm episode",
      notes: "",
      fields: { features: "" },
      author: identity?.user.name ?? "You",
    };
    update((s) => ({ ...s, activities: [...s.activities, episode] }));
    setMessage("Spasm tracking started.");
  }
  function startQuickTimer(timerKind: "Sleep" | "Nursing" | "Pumping", side?: "Left" | "Right") {
    if (!child.id) {
      setSheet("addChild");
      return;
    }
    if (active) {
      setMessage(`Stop the ${active.kind.toLowerCase()} timer before starting another.`);
      return;
    }
    const time = Date.now();
    const activity: Activity = {
      id: crypto.randomUUID(),
      childId: child.id,
      kind: timerKind,
      start: time,
      timer: true,
      segments: [{ start: time, side }],
      detail: side ?? "",
      notes: "",
      fields: {},
      author: identity?.user.name ?? "You",
    };
    update((s) => ({ ...s, activities: [...s.activities, activity] }));
    setMessage(`${timerKind} timer started.`);
  }
  function chooseNursingSide(side: "Left" | "Right") {
    if (!active || active.kind !== "Nursing") {
      startQuickTimer("Nursing", side);
      return;
    }
    if (active.segments?.at(-1)?.side === side && !active.segments.at(-1)?.end) return;
    const time = Date.now();
    const segments: NonNullable<Activity["segments"]> = (active.segments ?? []).map((segment) => ({
      ...segment,
      end: segment.end ?? time,
    }));
    segments.push({ start: time, end: undefined, side });
    const next = { ...active, detail: side, segments };
    update((s) => ({
      ...s,
      activities: s.activities.map((activity) =>
        activity.id === active.id ? next : activity,
      ),
    }));
  }
  function toggleSpasmFeature(feature: string) {
    if (!activeSpasm) return;
    const selected = new Set(
      (activeSpasm.fields?.features ?? "").split("|").filter(Boolean),
    );
    if (selected.has(feature)) selected.delete(feature);
    else selected.add(feature);
    const next = {
      ...activeSpasm,
      fields: { ...activeSpasm.fields, features: [...selected].join("|") },
    };
    update((s) => ({
      ...s,
      activities: s.activities.map((a) =>
        a.id === activeSpasm.id ? next : a,
      ),
    }));
  }
  function stopSpasm() {
    if (!activeSpasm) return;
    const next = { ...activeSpasm, end: Date.now() };
    update((s) => ({
      ...s,
      activities: s.activities.map((a) =>
        a.id === activeSpasm.id ? next : a,
      ),
    }));
    setMessage("Spasm episode saved.");
  }
  function save(timer = false) {
    const time =
      edit && start === localTime(edit.start) ? edit.start : +new Date(start);
    const finish = end
      ? edit?.end && end === localTime(edit.end)
        ? edit.end
        : +new Date(end)
      : undefined;
    if (
      !Number.isFinite(time) ||
      time > Date.now() + 60000 ||
      (finish !== undefined &&
        (!Number.isFinite(finish) ||
          finish < time ||
          finish > Date.now() + 60000))
    ) {
      setMessage("Please check the start and end times.");
      return;
    }
    if (
      (kind === "Feed" || kind === "Pumping") &&
      (!Number.isFinite(+amount) || +amount <= 0 || +amount > 3000)
    ) {
      setMessage("Enter an amount between 1 and 3,000 ml.");
      return;
    }
    if (
      (kind === "Sleep" || timer) &&
      !finish &&
      active &&
      active.id !== edit?.id
    ) {
      setMessage("A timer is already running for this child.");
      return;
    }
    if (
      kind === "Spasm" &&
      !finish &&
      activeSpasm &&
      activeSpasm.id !== edit?.id
    ) {
      setMessage("A spasm episode is already being tracked.");
      return;
    }
    if (kind === "Sleep" && !finish && !timer && !edit) {
      setMessage("Choose an end time, or start a timer.");
      return;
    }
    const a: Activity = {
      id: edit?.id ?? crypto.randomUUID(),
      childId: ["Pregnancy", "Postpartum"].includes(kind)
        ? undefined
        : child.id,
      adultId: ["Pregnancy", "Postpartum"].includes(kind)
        ? (edit?.adultId ?? identity?.user.id ?? "local-parent")
        : undefined,
      kind,
      start: time,
      end: finish,
      timer: timer || edit?.timer,
      segments: timer
        ? [{ start: time, side: kind === "Nursing" ? "Left" : undefined }]
        : edit?.segments?.map((v) => ({ ...v, end: v.end ?? finish })),
      amount: kind === "Feed" || kind === "Pumping" ? +amount : undefined,
      detail,
      notes,
      fields: extra,
      naraFields: edit?.naraFields,
      naraSource: edit?.naraSource,
      author: edit?.author ?? identity?.user.name ?? "You",
    };
    update((s) => ({
      ...s,
      activities: [...s.activities.filter((x) => x.id !== a.id), a],
    }));
    setSheet("");
    setMessage(
      timer
        ? identity
          ? "Timer started. Syncing reminder schedule."
          : "Timer started. Preview reminders are not connected."
        : "Entry saved on this device.",
    );
  }
  function stop() {
    if (!active) return;
    const finish = Date.now();
    const next = {
      ...active,
      end: finish,
      segments: active.segments?.map((v) => ({ ...v, end: v.end ?? finish })),
    };
    update((s) => ({
      ...s,
      activities: s.activities.map((a) => (a.id === active.id ? next : a)),
    }));
    open(active.kind, next);
  }
  function row(a: Activity) {
    return (
      <button className="event-row" key={a.id} onClick={() => open(a.kind, a)}>
        <Mark kind={a.kind} />
        <span>
          <small>
            {tab === "History"
              ? new Date(a.start).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : relative(a.start)}
          </small>
          <strong>{a.kind}</strong>
          <small>
            {a.amount ? `${a.amount} ml · ` : ""}
            {a.kind === "Sleep" || a.kind === "Spasm" || a.timer
              ? a.end
                ? duration(timerElapsed(a))
                : "In progress"
              : a.detail}
            {a.kind === "Spasm" && a.fields?.features
              ? ` · ${a.fields.features.split("|").join(", ")}`
              : ""}
            {tab === "History" ? ` · ${a.author}` : ""}
          </small>
        </span>
        <ChevronRightIcon />
      </button>
    );
  }
  const days = Array.from({ length: period }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - period + i);
    return d;
  });
  const values = days.map((d) =>
    metric === "Sleep"
      ? sleepForDay(events, d) / 3600000
      : events
          .filter(
            (a) =>
              todayKey(a.start) === todayKey(+d) &&
              a.kind === (metric === "Feeding" ? "Feed" : "Diaper"),
          )
          .reduce(
            (v, a) => v + (metric === "Feeding" ? (a.amount ?? 0) : 1),
            0,
          ),
  );
  const trendScale = graphScale(0, Math.max(1, ...values), 6, metric === "Sleep" ? .5 : 1);
  const avg = values.reduce((a, b) => a + b, 0) / period;
  const unassignedPumpCount = new Set(
    naraPreviews.flatMap((preview) => preview.unassignedPumpKeys),
  ).size;
  const unassignedPumpRows = naraPreviews.reduce(
    (total, preview) => total + preview.unassignedPumpKeys.length,
    0,
  );
  const targetNewChildren = Object.values(naraTargets).filter(
    (target) => target === "new",
  ).length;
  const hasImportedFile = naraPreviews.some((preview) =>
    state.naraImports.some((archive) => archive.id === preview.sha256),
  );
  const hasUnsupportedType = naraPreviews.some(
    (preview) => preview.unsupportedTypes.length > 0,
  );
  const naraImportDisabled =
    naraImporting ||
    hasImportedFile ||
    hasUnsupportedType ||
    naraPreviews.some((preview) => !naraTargets[preview.sha256]) ||
    state.children.length + targetNewChildren > 5 ||
    (unassignedPumpCount > 0 && !unassignedPumpTarget);
  return (
    <div className={`baby-app ${state.theme}`}>
      <MobileScroll className="baby-scroll">
        <main className="baby-content">
          <header className="brand">
            <span>Did I Feed My Baby?</span>
            <SunIcon />
            <button className="notification-bell" aria-label="Recent notifications" onClick={() => setSheet("notificationInbox")}>
              <BellIcon />
              {recentNotifications.some(event => event.status === "active") && <span className="notification-bell-count">{recentNotifications.filter(event => event.status === "active").length}</span>}
              {(alertConnection === "error" || pushStatus.state === "error") && <span className="notification-bell-error" aria-label="Notification connection needs attention" />}
            </button>
            <button aria-label="Open family" onClick={() => setTab("Family")}>
              <PersonIcon />
            </button>
          </header>
          {identity && alertConnection === "error" && <div className="notification-connection-warning" role="status">
            Owlet alert connection unavailable. Retrying automatically.
            <button onClick={() => setSheet("notifications")}>Check notifications</button>
          </div>}
          {tab !== "Family" && child.id && (
            <button
              className="child-selector"
              onClick={() => setSheet("children")}
            >
              <span className="avatar">
                <BabyIcon />
              </span>
              <strong>{child.name}</strong>
              <span>· {age(child.birthDate)}</span>
              <ChevronDownIcon />
            </button>
          )}
          {!state.demo && (
            <div className="cloud-info">
              {cloudStatus} ·{" "}
              {identity?.families.find((f) => f.id === familyId)?.name}
            </div>
          )}
          {cloudStatus === "Needs review" && (
            <div className="conflict">
              <strong>Another caregiver updated this household.</strong>
              <p>
                Your changes are safe on this device. Export them before loading
                the shared version.
              </p>
              <button
                onClick={() =>
                  download(
                    JSON.stringify(state, null, 2),
                    "application/json",
                    "unsynced-records.json",
                  )
                }
              >
                Export my changes
              </button>
              <button
                onClick={() =>
                  acceptRemote().catch((e) => setMessage(e.message))
                }
              >
                Use shared version
              </button>
            </div>
          )}
          {state.demo && (
            <div className="demo-note">
              Personal preview · sample records ·{" "}
              {saved ? "saved locally" : "saving…"}
            </div>
          )}
          {tab === "Today" && (
            <>
              <h1 className="answer">
                {lastFeed
                  ? relative(lastFeed.start) === "Just now"
                    ? "Yes. Just now."
                    : `Yes. ${relative(lastFeed.start)}.`
                  : "Time for a fresh start."}
              </h1>
              <p className="subtitle">
                {lastFeed
                  ? `Last feed${lastFeed.amount ? ` · ${lastFeed.amount} ml` : ""}`
                  : "Log your first feed below."}
              </p>
              <section className="timer-hub" aria-labelledby="timer-hub-title">
                <div className="timer-hub-heading">
                  <div>
                    <h2 id="timer-hub-title">Quick actions</h2>
                    <p>Your most-used activities, ready to go.</p>
                  </div>
                  <div className="timer-hub-tools">
                    <button aria-label="Customize quick actions" onClick={() => setSheet("settings")}>
                      <GearIcon />
                    </button>
                    <button aria-label="More activities" onClick={() => setSheet("more")}>
                      <PlusIcon />
                    </button>
                  </div>
                </div>
                {active && (
                  <div className="timer-hub-running" role="status">
                    <div>
                      <small>{active.kind} in progress</small>
                      <strong>{duration(timerElapsed(active, now))}</strong>
                    </div>
                    <div className="timer-hub-running-actions">
                      <button onClick={() => open(active.kind, active)}>Details</button>
                      <button className="timer-hub-stop" onClick={active.kind === "Spasm" ? stopSpasm : stop}>
                        Stop
                      </button>
                    </div>
                  </div>
                )}
                <div className="timer-hub-grid">
                  {quickActions.map((action) => {
                    if (action === "Nursing") return (
                      <div key={action} className={`timer-choice nursing${active?.kind === action ? " running" : ""}`}>
                        <div className="timer-choice-label"><HeartIcon /><strong>Nursing</strong></div>
                        <div className="nursing-starts">
                          {(["Left", "Right"] as const).map((side) => (
                            <button
                              key={side}
                              disabled={!!active && active.kind !== action}
                              aria-label={`${active?.kind === action ? "Switch nursing to" : "Start nursing on"} ${side.toLowerCase()} side`}
                              aria-pressed={active?.kind === action && active.segments?.at(-1)?.side === side && !active.segments.at(-1)?.end}
                              onClick={() => chooseNursingSide(side)}
                            >{side}</button>
                          ))}
                        </div>
                      </div>
                    );
                    const ActionIcon = activityIcons[action];
                    const timed = action === "Sleep" || action === "Pumping" || action === "Spasm";
                    const running = active?.kind === action;
                    return (
                      <button
                        key={action}
                        className={`timer-choice ${action.toLowerCase()}${running ? " running" : ""}`}
                        disabled={timed && !!active && !running}
                        onClick={() => {
                          if (running) open(action, active);
                          else if (action === "Spasm") startSpasm();
                          else if (action === "Sleep" || action === "Pumping") startQuickTimer(action);
                          else open(action);
                        }}
                      >
                        {action === "Feed" || action === "Diaper"
                          ? <Mark kind={action} />
                          : <ActionIcon />}
                        <span>
                          <strong>{action === "Feed" ? "Bottle feed" : action}</strong>
                          <small>{running ? "View timer" : timed ? action === "Spasm" ? "Start episode" : "Start now" : "Log now"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!quickActions.length && !active && (
                  <p className="timer-hub-empty">Choose actions in Settings to put them here.</p>
                )}
                {activeSpasm && (
                  <div className="timer-hub-features">
                    <p>Tap each sign you notice</p>
                    <div className="spasm-features">
                      {spasmFeatures.map((feature) => {
                        const selected = (activeSpasm.fields?.features ?? "").split("|").includes(feature);
                        return (
                          <button
                            key={feature}
                            className={selected ? "selected" : ""}
                            aria-pressed={selected}
                            onClick={() => toggleSpasmFeature(feature)}
                          >{feature}</button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {todaysSpasms.length > 0 && !activeSpasm && (
                  <p className="timer-hub-count">{todaysSpasms.length} {todaysSpasms.length === 1 ? "episode" : "episodes"} today</p>
                )}
              </section>
              {currentOwlet && (
                <button className="owlet-card" onClick={() => openOwlet()}>
                  <span className="owlet-card-heading">
                    <HeartIcon />
                    <strong>Owlet Dream Sock{owletDemo ? " · Demo" : ""}</strong>
                    <ChevronRightIcon />
                  </span>
                  {currentOwlet.measured_at ? (
                    <>
                      <span className="owlet-vitals">
                        <span><strong>{currentOwlet.heart_rate ?? "—"}</strong><small>heart rate · bpm</small></span>
                        <span><strong>{currentOwlet.oxygen_percent ?? "—"}</strong><small>oxygen · %</small></span>
                        <span><strong>{currentOwlet.battery_percent ?? "—"}</strong><small>battery · %</small></span>
                      </span>
                      <small>Owlet reading · {relative(Date.parse(currentOwlet.measured_at))}</small>
                    </>
                  ) : <small>Connected · waiting for the first reading</small>}
                  {currentOwlet.latest_alert_at && Date.now() - Date.parse(currentOwlet.latest_alert_at) < 60 * 60 * 1000 && (
                    <small className="owlet-alert-inline">Recent custom alert: {owletAlertLabel(currentOwlet.latest_alert_kind ?? "")}</small>
                  )}
                  {currentOwlet.last_error && <small>Sync needs attention · tap to review</small>}
                </button>
              )}
              <section className="recent">
                <div className="section-title">
                  <h2>Recent activity</h2>
                  <button onClick={() => setTab("History")}>View all</button>
                </div>
                {events.length ? (
                  events
                    .filter(
                      (a) =>
                        a.end ||
                        !(a.kind === "Sleep" || a.timer || a.kind === "Spasm"),
                    )
                    .slice(0, 2)
                    .map(row)
                ) : (
                  <p>No entries yet. Your day starts here.</p>
                )}
              </section>
            </>
          )}
          {tab === "History" && (
            <>
              <h1>History</h1>
              {lastDeleted && (
                <button
                  className="more-action"
                  onClick={() => {
                    update((s) => ({
                      ...s,
                      activities: s.activities.map((a) =>
                        a.id === lastDeleted ? { ...a, deleted: false } : a,
                      ),
                    }));
                    setLastDeleted("");
                  }}
                >
                  Undo last deletion
                </button>
              )}
              <label className="date-label">
                Show day
                <KeyboardInput
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="segments">
                {["All", "Feed", "Diaper", "Sleep", "Spasm"].map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "selected" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {events
                .filter(
                  (a) =>
                    todayKey(a.start) === date &&
                    (filter === "All" || a.kind === filter),
                )
                .map(row)}
              {!events.some(
                (a) =>
                  todayKey(a.start) === date &&
                  (filter === "All" || a.kind === filter),
              ) && <p className="empty">No entries for this day and filter.</p>}
              <button className="more-action" onClick={() => open("Feed")}>
                <PlusIcon />
                Add past activity
              </button>
            </>
          )}
          {tab === "Trends" && (
            <>
              <h1>Trends</h1>
              {(identity || owletDemo) && <button className="more-action" onClick={() => openOwlet()}><HeartIcon /> Owlet graphs and archive <ChevronRightIcon /></button>}
              <div className="segments">
                {[7, 30].map((n) => (
                  <button
                    key={n}
                    className={period === n ? "selected" : ""}
                    onClick={() => setPeriod(n)}
                  >
                    {n} days
                  </button>
                ))}
              </div>
              <div className="segments metric">
                {["Sleep", "Feeding", "Diapers"].map((m) => (
                  <button
                    key={m}
                    className={metric === m ? "selected" : ""}
                    onClick={() => setMetric(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <h2 className="stat">
                {metric === "Sleep"
                  ? `${Math.floor(avg)}h ${Math.round((avg % 1) * 60)}m`
                  : `${Math.round(avg)}${metric === "Feeding" ? " ml" : ""}`}
              </h2>
              <p className="subtitle">Average daily {metric.toLowerCase()}</p>
              <p className="muted">
                Completed days · missing days count as zero
              </p>
              <p className="muted trend-axis-unit">{metric === "Sleep" ? "Hours" : metric === "Feeding" ? "ml" : "Diapers"}</p>
              <div className="trend-chart">
                <div className="trend-y-axis" aria-label="Y axis">
                  {trendScale.ticks.map(v => <small key={v} style={{ bottom: `${v / trendScale.hi * 145}px` }}>{v}</small>)}
                </div>
              <div
                className="chart"
                aria-label={`${metric} totals for the last ${period} completed days`}
              >
                <div className="trend-grid" aria-hidden="true">
                  {trendScale.ticks.map(v => <i key={v} style={{ bottom: `${v / trendScale.hi * 145}px` }} />)}
                </div>
                {values.map((v, i) => (
                  <div className="trend-bar"
                    key={+days[i]}
                    title={`${days[i].toLocaleDateString()}: ${v.toFixed(1)}`}
                  >
                    <span
                      style={{
                        height: `${Math.max(2, (v / trendScale.hi) * 145)}px`,
                      }}
                    />
                    <small>
                      {period === 7
                        ? days[i].toLocaleDateString([], { weekday: "short" })
                        : i % 5 === 0
                          ? days[i].getDate()
                          : ""}
                    </small>
                  </div>
                ))}
              </div>
              </div>
              <p className="empty">
                {values.some((v) => v > 0)
                  ? "Based on your saved records."
                  : "Your trends will grow as you log activities."}
              </p>
              <button
                className="more-action"
                onClick={() => {
                  setFilter(
                    metric === "Feeding"
                      ? "Feed"
                      : metric === "Diapers"
                        ? "Diaper"
                        : "Sleep",
                  );
                  setTab("History");
                }}
              >
                View entries
                <ChevronRightIcon />
              </button>
            </>
          )}
          {tab === "Family" && (
            <>
              <div className="section-title">
                <h1>Our family</h1>
                <button
                  aria-label="Settings"
                  onClick={() => setSheet("settings")}
                >
                  <GearIcon />
                </button>
              </div>
              <p className="subtitle">
                {identity?.families.find((f) => f.id === familyId)?.name ??
                  "Your household preview"}
              </p>
              <div className="section-title">
                <h2>Children</h2>
                <span>{state.children.length} of 5</span>
              </div>
              {state.children.map((c) => (
                <button
                  className="child-selector"
                  key={c.id}
                  onClick={() => {
                    setChildEdit(c.id);
                    setName(c.name);
                    setBirth(c.birthDate);
                    setSex(c.sex);
                    setSheet("addChild");
                  }}
                >
                  <span className="avatar">{c.name[0]}</span>
                  <strong>{c.name}</strong>
                  <span>{age(c.birthDate)}</span>
                  <ChevronRightIcon />
                </button>
              ))}
              <button
                className="more-action"
                disabled={state.children.length >= 5}
                onClick={() => {
                  setChildEdit("");
                  setName("");
                  setBirth("");
                  setSex("Not specified");
                  setSheet("addChild");
                }}
              >
                <PlusIcon />
                Add child
              </button>
              <h2>Caregivers</h2>
              {(members.length
                ? members
                : [{ id: "you", name: "You", role: "Local preview" }]
              ).map((m) => (
                <div className="event-row" key={m.id}>
                  <span className="avatar">
                    <PersonIcon />
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.role}</small>
                  </span>
                  {identity?.families.find((f) => f.id === familyId)?.role ===
                    "owner" &&
                    m.id !== identity?.user.id && (
                      <button
                        aria-label={`Remove ${m.name}`}
                        onClick={() => {setRemovingMember({id:m.id,name:m.name});setSheet("removeMember");}}
                      >
                        Remove
                      </button>
                    )}
                </div>
              ))}
              <button
                className="feed-action small-action"
                onClick={() => setSheet("invite")}
              >
                <PersonIcon />
                Invite caregiver
                <ChevronRightIcon />
              </button>
              <p className="muted">
                Everyone invited can view and edit household records.
              </p>
              <button className="menu-row" onClick={() => setSheet("parents")}>
                <HeartIcon />
                Pregnancy & postpartum
                <ChevronRightIcon />
              </button>
              <button className="menu-row" onClick={() => setSheet("export")}>
                <DownloadIcon />
                Import / export data
                <ChevronRightIcon />
              </button>
              <button className="menu-row" onClick={() => openOwlet()}>
                <HeartIcon />
                Owlet Dream Sock
                <ChevronRightIcon />
              </button>
              <button className="menu-row" onClick={() => setSheet("settings")}>
                <BellIcon />
                My settings
                <ChevronRightIcon />
              </button>
            </>
          )}
        </main>
      </MobileScroll>
      <footer className="app-footer">
        {active && (
          <div className="active-timer">
            <button onClick={() => open(active.kind, active)}>
              {active.kind === "Sleep" ? <MoonIcon /> : <ClockIcon />}
              <span>
                {child.name} · {active.kind.toLowerCase()}
                <small>{duration(timerElapsed(active, now))}</small>
              </span>
            </button>
            <button className="stop" onClick={active.kind === "Spasm" ? stopSpasm : stop}>
              Stop
            </button>
          </div>
        )}
        <nav>
          {tabs.map((t, i) => {
            const Icon = icons[i];
            return (
              <button
                key={t}
                className={tab === t ? "current" : ""}
                onClick={() => setTab(t)}
              >
                <Icon />
                <span>{t}</span>
              </button>
            );
          })}
        </nav>
      </footer>
      {identity && familyId && <OwletUrgentAlerts key={familyId} family={familyId} theme={state.theme} inAppEnabled={notificationOptions.inApp} settingsOpen={["notifications","notificationInbox"].includes(sheet)} onOpenSettings={() => setSheet("notifications")} onConnection={reportAlertConnection} />}
      {message && !sheet && (
        <SwipeNotice className="toast" role="status" onDismiss={() => setMessage("")}>{message}</SwipeNotice>
      )}
      <BottomSheet
        open={!!sheet}
        theme={state.theme}
        onBack={() => {
          if(sheet==="owletStandby"){setSheet("owlet");return;}
          if(sheet==="owlet" && owletFocusedMetric){setOwletFocusedMetric(null);return;}
          if(["owletConnection","owletAlerts","owletDownloads"].includes(sheet)){openOwlet("settings");return;}
          if(sheet==="owletLogs"){openOwlet("owlet");return;}
          if(sheet==="notifications"){setSheet("settings");return;}
          if(sheet==="naraPreview"){setSheet("export");return;}
          if(sheet.startsWith("owlet"))setOwletPassword("");
          setRemovingMember(null);setSheet("");
        }}
        onOpenChange={(v) => {
          if (!v) {
            if (sheet.startsWith("owlet")) setOwletPassword("");
            setRemovingMember(null);setSheet("");
          }
        }}
        title={
          sheet === "log"
            ? `${edit ? "Edit" : "Log"} ${kind.toLowerCase()}`
            : sheet === "more"
              ? "More activities"
              : sheet === "removeMember"
                ? "Remove caregiver"
              : sheet === "settings"
                ? "Your settings"
                : sheet === "notifications" ? "Notifications"
                : sheet === "notificationInbox" ? "Recent notifications"
                : sheet.startsWith("owlet")
                  ? ({owlet:"Owlet Dream Sock",owletConnection:"Sock connection",owletAlerts:"Custom alerts",owletDownloads:"Download Owlet history",owletLogs:"Full Owlet logs"}[sheet] ?? "Owlet")
                : sheet === "children"
                  ? "Choose child"
                  : sheet === "addChild"
                    ? childEdit
                      ? "Edit child"
                      : "Add child"
                    : sheet === "invite"
                      ? "Invite caregiver"
                      : sheet === "parents"
                        ? "Parent tracking"
                        : sheet === "naraPreview"
                          ? "Review Nara import"
                          : "Import & export data"
        }
      >
        <div className={`sheet-body${sheet === "owlet" ? " owlet-sheet-body" : ""}`}>
          {message && <SwipeNotice className="toast sheet-toast" role="status" onDismiss={() => setMessage("")}>{message}</SwipeNotice>}
          {sheet==="removeMember" && removingMember && <>
            <p>Remove {removingMember.name} from this household?</p>
            <p className="muted">They will lose access to the household’s records.</p>
            <button className="danger" disabled={memberBusy} onClick={() => {
              setMemberBusy(true);
              void api("/families/"+familyId+"/remove-member",{userId:removingMember.id})
                .then(()=>{setMembers(current=>current.filter(member=>member.id!==removingMember.id));setSheet(current=>current==="removeMember"?"":current);setRemovingMember(null);})
                .catch(error=>setMessage(error.message)).finally(()=>setMemberBusy(false));
            }}>{memberBusy ? "Removing…" : "Remove caregiver"}</button>
            <button className="more-action" disabled={memberBusy} onClick={()=>{setRemovingMember(null);setSheet("");}}>Cancel</button>
          </>}
          {sheet === "log" && (
            <>
              <p className="muted">For {child.name}</p>
              {(kind === "Feed" || kind === "Pumping") && (
                <label>
                  Amount (ml)
                  <KeyboardInput
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              )}
              {kind === "Feed" && (
                <div className="segments">
                  {["Breast milk", "Formula", "Mixed"].map((v) => (
                    <button
                      className={detail === v ? "selected" : ""}
                      key={v}
                      onClick={() => setDetail(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {kind === "Diaper" && (
                <div className="segments">
                  {["Wet", "Dirty", "Both", "Dry"].map((v) => (
                    <button
                      className={detail === v ? "selected" : ""}
                      key={v}
                      onClick={() => setDetail(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
              <label>
                Start time
                <KeyboardInput
                  type="datetime-local"
                  step="1"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              {(["Sleep", "Nursing", "Pumping", "Spasm"].includes(kind) ||
                edit?.timer) && (
                <label>
                  End time (leave blank for active timer)
                  <KeyboardInput
                    type="datetime-local"
                    step="1"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              )}
              {kind === "Spasm" && (
                <fieldset className="spasm-edit-features">
                  <legend>Signs noticed</legend>
                  <div className="spasm-features">
                    {spasmFeatures.map((feature) => {
                      const selected = (extra.features ?? "")
                        .split("|")
                        .includes(feature);
                      return (
                        <button
                          key={feature}
                          type="button"
                          className={selected ? "selected" : ""}
                          aria-pressed={selected}
                          onClick={() => {
                            setExtra((current) => {
                              const features = new Set(
                                (current.features ?? "")
                                  .split("|")
                                  .filter(Boolean),
                              );
                              if (features.has(feature))
                                features.delete(feature);
                              else features.add(feature);
                              return {
                                ...current,
                                features: [...features].join("|"),
                              };
                            });
                          }}
                        >
                          {feature}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {(fieldSpecs[kind] ?? []).map(([key, label, options]) => (
                <label key={key}>
                  {label}
                  {options ? (
                    <Select
                      aria-label={label}
                      value={extra[key] ?? ""}
                      onValueChange={(value) =>
                        setExtra({ ...extra, [key]: value })
                      }
                    >
                      <option value="">Choose…</option>
                      {options.split("|").map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Select>
                  ) : (
                    <KeyboardInput
                      value={extra[key] ?? ""}
                      onChange={(e) =>
                        setExtra({ ...extra, [key]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              {!["Feed", "Diaper", "Sleep"].includes(kind) && (
                <label>
                  Details
                  <KeyboardInput
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder="What would you like to record?"
                  />
                </label>
              )}
              <label>
                Notes
                <KeyboardTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything to remember?"
                />
              </label>
              {edit?.naraFields && (
                <details className="nara-source-details">
                  <summary>Original Nara fields</summary>
                  <dl>
                    {Object.entries(edit.naraFields).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {edit.naraSource && (
                    <small>
                      Source row {edit.naraSource.rowNumber} · Nara activity key{" "}
                      {edit.naraSource.activityKey}
                    </small>
                  )}
                </details>
              )}
              {["Sleep", "Nursing", "Pumping"].includes(kind) &&
                !edit &&
                !active && (
                  <button className="primary" onClick={() => save(true)}>
                    Start {kind.toLowerCase()} timer
                  </button>
                )}
              {edit?.timer && !edit.end && (
                <>
                  <h2>{duration(timerElapsed(edit, now))}</h2>
                  <button
                    className="more-action"
                    onClick={() => {
                      const segments = [...(edit.segments ?? [])];
                      const last = segments.at(-1);
                      if (last && !last.end)
                        segments[segments.length - 1] = {
                          ...last,
                          end: Date.now(),
                        };
                      else
                        segments.push({ start: Date.now(), side: last?.side });
                      const next = { ...edit, segments };
                      update((s) => ({
                        ...s,
                        activities: s.activities.map((a) =>
                          a.id === edit.id ? next : a,
                        ),
                      }));
                      setEdit(next);
                    }}
                  >
                    {edit.segments?.at(-1)?.end
                      ? "Resume timer"
                      : "Pause timer"}
                  </button>
                  {kind === "Nursing" && (
                    <div className="segments">
                      {["Left", "Right"].map((side) => (
                        <button
                          key={side}
                          onClick={() => {
                            const time = Date.now();
                            const segments: NonNullable<Activity["segments"]> =
                              (edit.segments ?? []).map((v) => ({
                                ...v,
                                end: v.end ?? time,
                              }));
                            segments.push({
                              start: time,
                              end: undefined,
                              side,
                            });
                            const next = { ...edit, segments, detail: side };
                            update((s) => ({
                              ...s,
                              activities: s.activities.map((a) =>
                                a.id === edit.id ? next : a,
                              ),
                            }));
                            setEdit(next);
                            setDetail(side);
                          }}
                        >
                          {side}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <button className="primary" onClick={() => save()}>
                Save entry
              </button>
              {edit && (
                <button
                  className="danger"
                  onClick={() => {
                    update((s) => ({
                      ...s,
                      activities: s.activities.map((a) =>
                        a.id === edit.id ? { ...a, deleted: true } : a,
                      ),
                    }));
                    setLastDeleted(edit.id);
                    setSheet("");
                    setMessage(
                      "Entry removed. You can undo this from History.",
                    );
                  }}
                >
                  Delete entry
                </button>
              )}
            </>
          )}
          {sheet === "more" &&
            kinds
              .filter(
                (k) => !["Pregnancy", "Postpartum"].includes(k),
              )
              .map((k) => (
                <button className="menu-row" key={k} onClick={() => open(k)}>
                  <Mark kind={k} />
                  {k}
                  <ChevronRightIcon />
                </button>
              ))}
          {sheet === "parents" && (
            <>
              <p>
                Track your pregnancy and postpartum notes. Everyone in your
                household can view and edit these entries.
              </p>
              {state.activities
                .filter((a) => a.adultId && !a.deleted)
                .sort((a, b) => b.start - a.start)
                .slice(0, 10)
                .map(row)}
              {(["Pregnancy", "Postpartum"] as Kind[]).map((k) => (
                <button className="menu-row" key={k} onClick={() => open(k)}>
                  <HeartIcon />
                  {k}
                  <ChevronRightIcon />
                </button>
              ))}
            </>
          )}
          {sheet === "children" &&
            state.children.map((c) => (
              <button
                className="menu-row"
                key={c.id}
                onClick={async () => {
                  try {
                    setState(await selectChild(c.id));
                    setSheet("");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Could not select this child.");
                  }
                }}
              >
                {c.name}
                {c.id === child.id ? <CheckIcon /> : <ChevronRightIcon />}
              </button>
            ))}
          {sheet === "addChild" && (
            <>
              <label>
                Name
                <KeyboardInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Birth date
                <KeyboardInput
                  type="date"
                  value={birth}
                  onChange={(e) => setBirth(e.target.value)}
                />
              </label>
              <label>
                Sex
                <Select value={sex} onValueChange={(value) => setSex(value)}>
                  {["Not specified", "Female", "Male", "Intersex"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </label>
              {childEdit &&
                state.children.find((candidate) => candidate.id === childEdit)
                  ?.naraFields && (
                  <details className="nara-source-details">
                    <summary>Original Nara profile fields</summary>
                    <dl>
                      {Object.entries(
                        state.children.find(
                          (candidate) => candidate.id === childEdit,
                        )!.naraFields!,
                      ).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              <button
                className="primary"
                onClick={() => {
                  if (
                    !name.trim() ||
                    !birth ||
                    birth > todayKey(Date.now()) ||
                    (!childEdit && state.children.length >= 5)
                  ) {
                    setMessage("Enter a name and a valid birth date.");
                    return;
                  }
                  const id = childEdit || crypto.randomUUID();
                  update((s) => ({
                    ...s,
                    children: childEdit
                      ? s.children.map((c) =>
                          c.id === id
                            ? { ...c, name: name.trim(), birthDate: birth, sex }
                            : c,
                        )
                      : [
                          ...s.children,
                          { id, name: name.trim(), birthDate: birth, sex },
                        ],
                    selected: id,
                  }));
                  setSheet("");
                }}
              >
                {childEdit ? "Save child" : "Add child"}
              </button>
            </>
          )}
          {sheet.startsWith("owlet") && <>
            {sheet !== "owletStandby" && <p className="owlet-child-context">{child.name}</p>}
            {sheet !== "owlet" && sheet !== "owletStandby" && <button className="more-action" onClick={() => openOwlet(["owletConnection","owletAlerts","owletDownloads"].includes(sheet) ? "settings" : "owlet")}>← {sheet === "owletLogs" ? "Owlet" : "Settings"}</button>}
            {sheet === "owletStandby" && <OwletStandby key={owletChildId} name={child.name} connection={selectedOwlet} data={owletHistoryData} hours={owletGraphHours} now={now} error={owletHistoryError} onRange={setOwletGraphHours} onExit={()=>setSheet("owlet")} onDetails={(metric,time)=>{owletInspectionTime.current=time;setOwletFocusedMetric(metric);setSheet("owlet");}} />}
            {sheet === "owletConnection" && <>              {!identity ? (
                <p>Sign in to a household to connect Owlet.</p>
              ) : owletStatus && !owletStatus.configured ? (
                <p>Owlet collection is not configured on this server.</p>
              ) : selectedOwlet ? (
                <div className="owlet-settings">
                  <h3>Connected sock</h3>
                  <p><strong>{selectedOwlet.device_name}</strong><br />
                    <small>{selectedOwlet.account_email}</small></p>
                  <p className="muted">
                    {selectedOwlet.measured_at
                      ? `Latest Owlet reading: ${new Date(selectedOwlet.measured_at).toLocaleString()}`
                      : "Waiting for the first reading."}
                  </p>
                  {selectedOwlet.last_error && (
                    <p className="owlet-error">Collection needs attention: {selectedOwlet.last_error}. Retry scheduled {new Date(selectedOwlet.next_poll_at).toLocaleTimeString()}.</p>
                  )}
                  <p className="muted">Collection target: every 5 seconds · Screen refresh: every 5 seconds while visible. Owlet may publish readings more slowly.</p>
                  <div className="owlet-actions">
                    <button disabled={owletBusy} onClick={() => void refreshOwlet()}>Refresh</button>
                    <button disabled={owletBusy} onClick={() => void loadOwletDevices()}>Choose sock</button>
                  </div>
                  {owletDevices.length > 0 && (
                    <label>
                      Owlet device
                      <Select
                        value={selectedOwlet.device_serial}
                        disabled={owletBusy}
                        onValueChange={(value) => void chooseOwletDevice(value)}
                      >
                        {owletDevices.map((device) => (
                          <option key={device.serial} value={device.serial}>
                            {device.name} · {device.model || device.serial}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                  <button className="more-action" disabled={owletBusy} onClick={() => void disconnectOwlet()}>
                    Disconnect Owlet
                  </button>
                  <p className="muted">Disconnecting stops collection and keeps readings already saved here.</p>

                </div>
              ) : (
                <>
                  <label>
                    Owlet account email
                    <KeyboardInput type="email" autoComplete="username" value={owletEmail} onChange={(e) => setOwletEmail(e.target.value)} />
                  </label>
                  <label>
                    Owlet account password
                    <KeyboardInput type="password" autoComplete="current-password" value={owletPassword} onChange={(e) => setOwletPassword(e.target.value)} />
                  </label>
                  <button className="primary" disabled={owletBusy || !owletChildId || !owletEmail || !owletPassword} onClick={() => void linkOwlet()}>
                    {owletBusy ? "Connecting…" : "Connect Owlet"}
                  </button>
                  <p className="muted">Your password is used once to connect and is not saved. The server stores encrypted access tokens. New readings begin when the sock reports; past Owlet history is not imported.</p>
                </>
              )}
</>}
            {sheet === "owletAlerts" && <>                  <div className="owlet-alert-config">
                    <h3>Custom alerts</h3>
                    <p className="muted">Set levels for this child. Leave any field blank to turn that alert off. New alert events use a 15-minute cooldown. With Repeat until accepted enabled, each event stays active until accepted, even if later readings recover.</p>
                    <div className="owlet-threshold-grid">
                      {([
                        ["oxygenBelow", "Oxygen below (%)", 100],
                        ["heartBelow", "Heart rate below (bpm)", 300],
                        ["heartAbove", "Heart rate above (bpm)", 300],
                        ["batteryBelow", "Sock battery below (%)", 100],
                      ] as const).map(([key, label, max]) => (
                        <label key={key}>{label}
                          <KeyboardInput type="number" inputMode="numeric" min="1" max={max} placeholder="Off"
                            value={owletAlertFields[key]}
                            onChange={(e) => setOwletAlertFields((current) => ({ ...current, [key]: e.target.value }))} />
                        </label>
                      ))}
                    </div>
                    <button className="primary" disabled={owletBusy || !owletAlertSettingsLoaded} onClick={() => void saveOwletAlerts()}>Save alert levels</button>
                    <button className="more-action" onClick={() => setSheet("notifications")}><BellIcon />Notification settings<ChevronRightIcon /></button>
                  </div>
                  <button className="more-action" onClick={() => setSheet("notificationInbox")}>View notification history<ChevronRightIcon /></button>
<p className="owlet-note">Keep the Owlet app and base station alerts enabled. Custom notifications are best effort.</p></>}
            {sheet === "owletDownloads" && <>                  <h3>Download Owlet history</h3>
                  <p className="muted">Exports include all saved history for this child. The poll archive contains complete provider responses and property metadata. Downloaded log file bytes are encoded as base64 in file exports.</p>
                  <div className="owlet-range-controls">
                    <label>Data<Select aria-label="Export dataset" value={owletExportDataset} onValueChange={(value) => setOwletExportDataset(value)}><option value="readings">Readings</option><option value="polls">Full poll archive</option><option value="alerts">Custom alerts</option><option value="files">Log files and metadata</option></Select></label>
                    <label>Format<Select value={owletExportFormat} onValueChange={(value) => setOwletExportFormat(value)}><option value="jsonl">JSON Lines</option><option value="csv">CSV</option></Select></label>
                  </div>
                  <a className="owlet-download" href={`/api/owlet/export?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(owletChildId)}&dataset=${owletExportDataset}&format=${owletExportFormat}`} download={`owlet-${owletExportDataset}.${owletExportFormat}`}>Download complete history</a>
</>}
            {sheet === "owlet" && <div className="owlet-settings">
              {owletDemo && <p className="muted" role="status">Demo readings · Sample data for exploring graphs, not live sock measurements.</p>}
              {!selectedOwlet && <p className="muted">No sock connected for this child. Connect one in Settings → Sock connection.</p>}
                  {!owletFocusedMetric && <button className="more-action" onClick={()=>{setOwletGraphHours(1/6);setOwletGraphEnd(null);setSheet("owletStandby");}}>Landscape standby <BarChartIcon /></button>}
                  <h3 id="owlet-graphs-title">{owletFocusedMetric ? "Graph details" : "Owlet graphs"}</h3>
                  {owletFocusedMetric && <button className="more-action" onClick={() => setOwletFocusedMetric(null)}>← Graph overview</button>}
                  <div className="owlet-range-controls">
                    <label>Range<Select aria-label="Graph range" value={owletGraphHours} onValueChange={(value) => {
                      const hours=Number(value);setOwletGraphHours(hours);
                      if(owletFocusedMetric && owletInspectionTime.current!==null){const end=owletInspectionTime.current+hours*3600000/2;setOwletGraphEnd(end>=Date.now()?null:end);}
                    }}>
                      {owletRanges.map(([hours,label]) => <option value={hours} key={hours}>{label}</option>)}
                    </Select></label>
                    <label>Window<Select aria-label="Graph window" value={owletGraphEnd === null ? "live" : "history"} onValueChange={(value) => setOwletGraphEnd(value === "live" ? null : Date.now())}><option value="live">Live</option><option value="history">Earlier history</option></Select></label>
                  </div>
                  <div className="owlet-actions">
                    <button onClick={() => setOwletGraphEnd((owletGraphEnd ?? Date.now())-owletGraphHours*3600000)}>← Earlier</button>
                    <button disabled={owletGraphEnd===null} onClick={() => { const next=(owletGraphEnd ?? Date.now())+owletGraphHours*3600000; setOwletGraphEnd(next>=Date.now() ? null : next); }}>Later →</button>
                  </div>
                  {owletGraphEnd !== null && <label>Window ending at<KeyboardInput type="datetime-local" value={localTime(owletGraphEnd)} onChange={(e) => { const value=Date.parse(e.target.value); if (Number.isFinite(value)) setOwletGraphEnd(Math.min(value,Date.now())); }} /></label>}
                  {owletHistoryError && <p className="owlet-error">{owletHistoryError}</p>}
                  {owletHistoryData ? <>
                    <p className="muted">{new Date(owletHistoryData.from).toLocaleString()} – {new Date(owletHistoryData.to).toLocaleString()}</p>
                    {owletHistoryData.readings.length ? <OwletGraphs data={owletHistoryData} activities={state.activities} childId={owletChildId} overviewMetrics={owletOverviewMetrics} onMetricChange={toggleOwletOverviewMetric} focused={owletFocusedMetric} onFocus={setOwletFocusedMetric} inspectionTime={owletInspectionTime} key={owletChildId} /> : <p className="muted">No saved readings in this window. Choose an earlier or wider range.</p>}
                  </> : !owletHistoryError && (identity ? <div className="owlet-graph-loading" role="status" aria-live="polite">
                    <p className="muted">Loading graph history…</p>
                    {["Owlet trend"].map(label => <div className="owlet-plot" key={label} aria-hidden="true">
                      <div className="owlet-plot-title"><strong>{label}</strong></div>
                      <div className="owlet-graph-placeholder" />
                    </div>)}
                  </div> : <p className="muted">Connect a sock in Settings to see saved readings.</p>)}
              {!owletFocusedMetric && <button className="more-action" onClick={() => openOwlet("owletLogs")}>Full logs <ChevronRightIcon /></button>}
            </div>}
            {sheet === "owletLogs" && <div className="owlet-settings">{owletHistoryData && <>                    <div className="owlet-archive-summary"><strong>Collection archive</strong><p>{owletHistoryData.archive.polls} polls · {owletHistoryData.archive.errors} failed attempts in this window</p><small>Average fetch time: {owletHistoryData.archive.average_duration_ms ?? "—"} ms. Every response is archived, including unchanged readings.</small></div>
                    <details className="owlet-reading-details"><summary>Recent collection attempts</summary>{(owletHistoryData.attempts ?? []).map((attempt,i) => <div className="owlet-file-row" key={attempt.id ?? i}><strong>{new Date(attempt.fetched_at).toLocaleString()} · {attempt.status}</strong><small>{attempt.duration_ms} ms{attempt.http_status ? ` · HTTP ${attempt.http_status}` : ""}{attempt.error ? ` · ${attempt.error}` : ""}</small><button className="more-action" onClick={() => { const chosen=owletChildId; void api(`/owlet/poll?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(chosen)}&id=${attempt.id}`).then((result) => setOwletPollDetails({childId:chosen,text:JSON.stringify(result,null,2)})).catch((error) => setMessage(error.message)); }}>View full response</button></div>)}{owletPollDetails?.childId === owletChildId && <pre className="owlet-raw-poll">{owletPollDetails.text}</pre>}</details>
</>}                  <details className="owlet-reading-details"><summary>Referenced log files</summary>
                    {owletHistoryData?.files.length ? owletHistoryData.files.map((file) => <div className="owlet-file-row" key={file.id}><strong>{owletFieldLabel(file.property_name)}</strong><small>{file.downloaded_at ? `${file.bytes} bytes archived` : file.last_error ?? "Waiting for download"}</small>{file.downloaded_at && <a href={`/api/owlet/file?family=${encodeURIComponent(familyId)}&child=${encodeURIComponent(owletChildId)}&id=${file.id}`} download>Download original file</a>}</div>) : <p className="muted">No referenced downloadable log files have been supplied yet. Inline log values remain in the poll archive.</p>}
                  </details>
                  <h3>Recent readings</h3>
                  <p className="muted">Showing {owletBefore ? "an earlier page of" : "the latest"} 100 readings. Open a reading to inspect provider fields.</p>
                  {owletReadings.length ? (
                    <div className="owlet-reading-list">
                      {owletReadings.map((reading) => (
                        <div key={reading.measured_at}>
                          <small>{new Date(reading.measured_at).toLocaleString()}</small>
                          <span>{reading.heart_rate ?? "—"} bpm · {reading.oxygen_percent ?? "—"}% oxygen · {reading.battery_percent ?? "—"}% battery</span>
                          <span>Movement {reading.movement ?? "—"} · Sleep state {reading.sleep_state ?? "—"} · Sock connection {reading.sock_connection ?? "—"} · Charging {reading.charging ? "Yes" : "No"}</span>
                          <details className="owlet-reading-details">
                            <summary>All available fields</summary>
                            <div className="owlet-fields">
                              {Object.entries(reading.provider_data?.vitals ?? {}).map(([key, value]) => (
                                <div key={`v-${key}`}><span>{owletFieldLabel(key)}</span><strong>{owletFieldValue(value)}</strong></div>
                              ))}
                              {Object.entries(reading.provider_data?.properties ?? {}).map(([key, value]) => (
                                <div key={`p-${key}`}><span>{owletFieldLabel(key)}</span><strong>{owletFieldValue(value)}</strong></div>
                              ))}
                              {Object.entries(reading.alerts ?? {}).map(([key, value]) => (
                                <div key={`a-${key}`}><span>{owletFieldLabel(key)}</span><strong>{value ? "Active" : "Clear"}</strong></div>
                              ))}
                            </div>
                            {Object.keys(reading.provider_data?.vitals ?? {}).length === 0 &&
                              Object.keys(reading.provider_data?.properties ?? {}).length === 0 &&
                              <small>Detailed provider fields were not saved for this earlier reading.</small>}
                          </details>
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted">No readings collected yet.</p>}
                  <div className="owlet-actions"><button disabled={!owletNextBefore} onClick={() => setOwletBefore(owletNextBefore)}>Older readings</button><button disabled={!owletBefore} onClick={() => setOwletBefore(null)}>Back to latest</button></div></div>}
          </>}
          {sheet === "notificationInbox" && <>
            <button className="more-action" onClick={() => setSheet("notifications")}><GearIcon />Notification settings<ChevronRightIcon /></button>
            {notificationHistoryError && <p className="notification-connection-warning" role="status">{notificationHistoryError}</p>}
            {!identity ? <p className="muted">Sign in to see your household’s notifications.</p> : !recentNotifications.length ? <p className="muted">{notificationHistoryLoaded ? "No notifications yet." : "Loading notifications…"}</p> :
              <div className="notification-history">{recentNotifications.map(event => <article className={`notification-history-item ${event.status}`} key={event.id}>
                <div className="notification-history-heading"><strong>{event.source === "owlet" ? `${event.child_name} · ${owletAlertLabel(event.kind)}` : event.title}</strong><span className={`notification-status ${event.status}`}>{({ active: "Active", paused: "Paused · charging", accepted: "Accepted", sent: "Sent" })[event.status]}</span></div>
                {event.source === "owlet" ? <p>{event.measured_value}{event.kind.startsWith("heart_") ? " bpm" : "%"} · your level {event.threshold_value}{event.kind.startsWith("heart_") ? " bpm" : "%"}</p> : <p>{event.body}</p>}
                <small>Started <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></small>
                {event.acknowledged_at && <small>Accepted <time dateTime={event.acknowledged_at}>{new Date(event.acknowledged_at).toLocaleString()}</time></small>}
                {["active","paused"].includes(event.status) && <button className="primary" disabled={acceptingNotification !== null} onClick={() => void acceptNotification(event)}>{acceptingNotification === event.id ? "Accepting…" : "Accept"}</button>}
              </article>)}</div>}
          </>}
          {sheet === "notifications" && <>
            <button className="more-action" onClick={() => setSheet("settings")}>← Your settings</button>
            <p className="muted">Phone notifications need permission on each device. Sound activates with a tap while the app is open.</p>
            <button className="primary" onClick={() => {
              setNotificationPreferences({ push: true, inApp: true, sound: true });
              const sound = enableOwletAlertSound(false);
              const push = identity ? enablePush() : Promise.reject(new Error("Sign in to enable phone notifications."));
              void Promise.allSettled([sound,push]).then(results => {
                const errors = results.flatMap(result => result.status === "rejected" ? [result.reason.message] : []);
                setMessage(errors.join(" ") || "Phone notifications, in-app alerts and sound are enabled on this device.");
                void reconcilePushRegistration().then(setPushStatus).catch(() => {});
              });
            }}>Enable this device</button>
            <div className="notification-settings-card">
              <h3>Phone notifications</h3>
              <label className="notification-option"><input type="checkbox" checked={notificationOptions.push} onChange={event => {
                if (event.target.checked) { void enablePush().then(() => reconcilePushRegistration().then(setPushStatus)).catch(error => setMessage(error.message)); }
                else void disablePush().then(() => setPushStatus({ state: "off", message: "Phone notifications are off on this device." })).catch(error => setMessage(error.message));
              }} /><span>Phone notifications<small>Alerts and reminders on your Lock Screen and in Notification Center.</small></span></label>
              {identity ? <DeviceNotifications status={pushStatus} onStatus={setPushStatus} /> : <p className="muted">Sign in to enable phone notifications.</p>}
              {identity && <button className="more-action" onClick={() => void reconcilePushRegistration().then(setPushStatus).catch(error => setMessage(error.message))}>Repair connection</button>}
              <p className="muted">This device reconnects automatically when you open or return to the app.</p>
            </div>
            <div className="notification-settings-card">
              <h3>Inside the app</h3>
              <label className="notification-option"><input type="checkbox" checked={notificationOptions.inApp} onChange={event => setNotificationPreferences({ inApp: event.target.checked })} /><span>In-app alert panels<small>Show active Owlet alerts across all pages. History and acceptance stay available from the bell.</small></span></label>
              <label className="notification-option"><input type="checkbox" checked={notificationOptions.sound} onChange={event => {
                setNotificationPreferences({ sound: event.target.checked });
                if (event.target.checked) void enableOwletAlertSound().catch(error => setMessage(error.message));
              }} /><span>Alert sound<small>Repeat every second while the app is visible and an alert is active.</small></span></label>
              <p className="muted" role="status">{!notificationOptions.sound ? "Alert sound is off." : soundReady ? "Sound is ready for this app session." : "Sound is on. Tap Enable alert sound to activate this session."}</p>
              {notificationOptions.sound && <button className="more-action" onClick={() => void enableOwletAlertSound().catch(error => setMessage(error.message))}>{soundReady ? "Test alert sound" : "Enable alert sound"}</button>}
              <p className={alertConnection === "error" ? "notification-connection-warning" : "muted"} role="status">{!identity ? "Sign in to receive live Owlet alerts." : alertConnection === "error" ? "Owlet alert connection unavailable. Retrying automatically." : alertConnection === "connected" ? "Owlet alert connection is up to date." : "Checking Owlet alert connection…"}</p>
            </div>
            <div className="notification-settings-card">
              <h3>Owlet · {child.name}</h3>
              <label className="notification-option"><input type="checkbox" checked={owletRepeatUntilAccepted} disabled={!identity || !owletAlertSettingsLoaded || owletBusy} onChange={event => {
                const enabled = event.target.checked;
                setOwletBusy(true);
                void api("/owlet/repeat", { family: familyId, childId: child.id, enabled }).then(() => { setOwletRepeatUntilAccepted(enabled); setMessage("Repeat preference saved for this child."); }).catch(error => setMessage(error.message)).finally(() => setOwletBusy(false));
              }} /><span>Repeat until accepted<small>Shared by your household. New alerts require explicit Accept; repeated pushes stay together in one history entry.</small></span></label>
              <button className="more-action" onClick={() => openOwlet("owletAlerts")}>Set Owlet alert levels<ChevronRightIcon /></button>
              <p className="muted">Acceptance stops repeats for everyone. Charging pauses alerts without accepting them. Existing active alerts still need acceptance when repeats are switched off.</p>
            </div>
              <h3>Timer reminders</h3>
              {identity && <p className="muted">The Home Screen badge counts Owlet alerts awaiting acceptance across your households. Enable notifications and badges in iOS settings to see it.</p>}
              <p>
                {identity
                  ? "Reminders are sent while your timer runs. Your device controls when they arrive."
                  : "Server reminders are unavailable in this local preview."}
              </p>
              <div className="segments">
                {[0, 1, 5, 10].map((n) => (
                  <button
                    key={n}
                    className={state.reminderMinutes === n ? "selected" : ""}
                    onClick={() => {
                      update((s) => ({ ...s, reminderMinutes: n }));
                      if (identity)
                        api("/preferences", { minutes: n }).catch((e) =>
                          setMessage(e.message),
                        );
                    }}
                  >
                    {n ? `${n} min` : "Off"}
                  </button>
                ))}
              </div>

            <button className="more-action" onClick={() => setSheet("notificationInbox")}>Recent notifications<ChevronRightIcon /></button>
          </>}
          {sheet === "settings" && (
            <>
              <button className="menu-row" onClick={() => setSheet("notifications")}><BellIcon />Notifications<ChevronRightIcon /></button>
              <h3>Owlet · {child.name}</h3>
              <button className="menu-row" onClick={() => openOwlet("owletConnection")}>Sock connection <ChevronRightIcon /></button>
              <button className="menu-row" onClick={() => openOwlet("owletAlerts")}>Custom alerts <ChevronRightIcon /></button>
              <button className="menu-row" onClick={() => openOwlet("owletDownloads")}>Download Owlet history <ChevronRightIcon /></button>
              {identity && identity.families.length > 1 && (
                <label>
                  Household
                  <Select
                    value={familyId}
                    onValueChange={(value) => {
                      location.href =
                        "/?family=" + encodeURIComponent(value);
                    }}
                  >
                    {identity.families.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <h3>Quick actions</h3>
              <p className="muted">Choose what appears on Today. Use the arrows to put your favorites first.</p>
              <div className="quick-settings-list">
                {[...quickActions, ...kinds.filter((action) => !quickActions.includes(action))].map((action) => {
                  const position = quickActions.indexOf(action);
                  const selected = position !== -1;
                  return (
                    <div className="quick-settings-row" key={action}>
                      <button
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        aria-label={`${selected ? "Remove" : "Add"} ${action === "Feed" ? "bottle feed" : action.toLowerCase()} ${selected ? "from" : "to"} quick actions`}
                        onClick={() => changeQuickActions(selected
                          ? quickActions.filter((item) => item !== action)
                          : [...quickActions, action])}
                      >
                        <span className="quick-settings-check">{selected && <CheckIcon />}</span>
                        {action === "Feed" ? "Bottle feed" : action}
                      </button>
                      {selected && (
                        <span className="quick-settings-order">
                          <button
                            aria-label={`Move ${action} up`}
                            disabled={position === 0}
                            onClick={() => {
                              const next = [...quickActions];
                              [next[position - 1], next[position]] = [next[position], next[position - 1]];
                              changeQuickActions(next);
                            }}
                          ><ChevronUpIcon /></button>
                          <button
                            aria-label={`Move ${action} down`}
                            disabled={position === quickActions.length - 1}
                            onClick={() => {
                              const next = [...quickActions];
                              [next[position], next[position + 1]] = [next[position + 1], next[position]];
                              changeQuickActions(next);
                            }}
                          ><ChevronDownIcon /></button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {identity && <OfflineStorage />}
              <h3>Appearance</h3>
              <div className="segments">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    className={state.theme === t ? "selected" : ""}
                    onClick={() => update((s) => ({ ...s, theme: t }))}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="muted">
                {identity
                  ? "Offline entries sync when you reconnect."
                  : "Records stay on this device in preview mode."}
              </p>
              {identity && (
                <button
                  className="more-action"
                  onClick={async () => {
                    try {
                      await sync();
                      if (syncStatus !== "Synced") {
                        setMessage(
                          "Sync or export pending records before signing out.",
                        );
                        return;
                      }
                      await api("/logout", {});
                      await clearLocal();
                      localStorage.removeItem("baby-last-identity");
                      localStorage.removeItem(`baby-owlet-pending-${familyId}`);
                      clearCloud();
                      await clearAlertBadge();
                      location.reload();
                    } catch (e: any) {
                      setMessage(e.message);
                    }
                  }}
                >
                  Sign out
                </button>
              )}
            </>
          )}
          {sheet === "invite" && (
            <>
              <p>
                Each caregiver uses their own login and can view and edit
                household tracking records.
              </p>
              {identity ? (
                <>
                  <button
                    className="primary"
                    onClick={() =>
                      api("/families/" + familyId + "/invite", {})
                        .then((v) => setInviteURL(v.url))
                        .catch((e) => setMessage(e.message))
                    }
                  >
                    Create invitation link
                  </button>
                  {inviteURL && (
                    <>
                      <label>
                        Share this link
                        <KeyboardInput readOnly value={inviteURL} />
                      </label>
                      {typeof navigator.share === "function" && <button
                        className="primary"
                        onClick={() => {
                          (document.activeElement as HTMLElement | null)?.blur();
                          void shareInvitation(inviteURL)
                            .then(result => { if (result === "shared") setMessage("Invitation shared."); })
                            .catch(error => setMessage(error.message));
                        }}
                      >Share invitation</button>}
                      <button
                        className="more-action"
                        onClick={() =>
                          copyInvitation(inviteURL)
                            .then(() => setMessage("Invitation copied."))
                            .catch(() =>
                              setMessage("Select and copy the link above."),
                            )
                        }
                      >
                        Copy link
                      </button>
                      <p className="muted">
                        Expires in 7 days. Send it only to the person you are
                        inviting.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p>
                  Invitations are available when signed into the shared app.
                </p>
              )}
            </>
          )}
          {sheet === "export" && (
            <>
              <p>
                Export records or import a Nara Baby CSV. Nara files are kept
                byte-for-byte in your backup, including columns this app does
                not display as activity fields.
              </p>
              <label className="nara-file-picker">
                Choose Nara export CSV files
                <input
                  className="nara-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  onChange={(event) => {
                    void chooseNaraFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                className="primary"
                onClick={() =>
                  download(
                    exportCSV(state.activities),
                    "text/csv",
                    "baby-activities.csv",
                  )
                }
              >
                Download CSV
              </button>
              <section className="nara-import-archives">
                <h3>Nara-format CSV export</h3>
                <p className="muted">
                  Downloads one child profile per file using the Nara columns.
                  Spasm episodes appear as Medical notes; pregnancy and
                  postpartum records remain in the full CSV and JSON backup.
                  Unassigned Pump entries remain in the original Nara files.
                  Nara’s public help describes CSV export but does not confirm
                  importing generated CSVs back into the app.
                </p>
                {state.children.map((profile) => (
                  <button
                    className="menu-row"
                    key={profile.id}
                    onClick={() => void downloadNaraExport(profile.id)}
                  >
                    <span>
                      <strong>{profile.name}</strong>
                      <small>Download Nara-format CSV</small>
                    </span>
                    <DownloadIcon />
                  </button>
                ))}
              </section>
              <button
                className="more-action"
                onClick={() =>
                  download(
                    JSON.stringify(state, null, 2),
                    "application/json",
                    "baby-backup.json",
                  )
                }
              >
                Download full JSON backup
              </button>
              {state.naraImports.length > 0 && (
                <section className="nara-import-archives">
                  <h3>Original Nara exports</h3>
                  <p className="muted">
                    These original files are retained with the household data.
                  </p>
                  {state.naraImports.map((archive) => (
                    <button
                      className="menu-row"
                      key={archive.id}
                      onClick={() =>
                        downloadBase64(
                          archive.contentBase64,
                          "text/csv;charset=utf-8",
                          archive.fileName,
                        )
                      }
                    >
                      <span>
                        <strong>{archive.profileName}</strong>
                        <small>{archive.fileName}</small>
                      </span>
                      <DownloadIcon />
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
          {sheet === "naraPreview" && (
            <>
              <p>
                Review the profiles and record counts before importing. Existing
                child profiles will use the Nara name, birth date, and sex.
                Original values and source files remain available afterward.
              </p>
              {naraPreviews.map((preview) => {
                const selectedTarget = naraTargets[preview.sha256] ?? "";
                const newCountWithoutThis =
                  targetNewChildren - (selectedTarget === "new" ? 1 : 0);
                const canAddChild =
                  state.children.length + newCountWithoutThis < 5;
                const alreadyImported = state.naraImports.some(
                  (archive) => archive.id === preview.sha256,
                );
                return (
                  <section className="nara-preview-file" key={preview.sha256}>
                    <h3>{preview.profileName}</h3>
                    <p className="muted">
                      {preview.fileName} · {preview.activityCount.toLocaleString()} records ·{" "}
                      {(preview.byteLength / 1024).toFixed(0)} KB
                    </p>
                    <label>
                      Import this profile into
                      <Select
                        value={selectedTarget}
                        onValueChange={(value) =>
                          setNaraTargets((current) => ({
                            ...current,
                            [preview.sha256]: value,
                          }))
                        }
                      >
                        <option value="">Choose a child…</option>
                        {state.children.map((existingChild) => (
                          <option key={existingChild.id} value={existingChild.id}>
                            {existingChild.name} · existing child
                          </option>
                        ))}
                        <option value="new" disabled={!canAddChild}>
                          Add {preview.profileName} as a new child
                        </option>
                      </Select>
                    </label>
                    <div className="nara-type-counts">
                      {Object.entries(preview.typeCounts).map(([type, count]) => (
                        <span key={type}>
                          {type} · {count.toLocaleString()}
                        </span>
                      ))}
                    </div>
                    {preview.unsupportedTypes.length > 0 && (
                      <p className="nara-import-error">
                        Unsupported Nara categories: {preview.unsupportedTypes.join(", ")}
                      </p>
                    )}
                    {alreadyImported && (
                      <p className="nara-import-error">
                        This exact file has already been imported.
                      </p>
                    )}
                  </section>
                );
              })}
              {unassignedPumpCount > 0 && (
                <section className="nara-unassigned">
                  <h3>Unassigned Pump records</h3>
                  <p>
                    Nara leaves {unassignedPumpCount.toLocaleString()} unique Pump records without a child profile. The selected exports contain {unassignedPumpRows - unassignedPumpCount} duplicate rows with the same Nara activity keys.
                  </p>
                  <label>
                    How should these records be handled?
                    <Select
                      value={unassignedPumpTarget}
                      onValueChange={(value) =>
                        setUnassignedPumpTarget(value)
                      }
                    >
                      <option value="">Choose how to handle them…</option>
                      <option value="archive-only">
                        Keep them in the original files only
                      </option>
                      {state.children.map((existingChild) => (
                        <option key={existingChild.id} value={existingChild.id}>
                          Add to {existingChild.name}
                        </option>
                      ))}
                      {naraPreviews.map((preview) => (
                        <option
                          key={preview.sha256}
                          value={`profile:${preview.sha256}`}
                        >
                          Add to {preview.profileName}
                        </option>
                      ))}
                    </Select>
                  </label>
                </section>
              )}
              <button
                className="primary"
                disabled={naraImportDisabled}
                onClick={() => void saveNaraImport()}
              >
                {naraImporting ? "Importing…" : "Import Nara records"}
              </button>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
