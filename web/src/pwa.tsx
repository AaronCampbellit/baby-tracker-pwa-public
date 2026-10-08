import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Prototype from "./Prototype";
import { api, clearCloud, configureCloud, type Identity } from "./domain/cloud";
import { sync } from "./domain/store";
import { watchReconnection } from "./domain/offline-storage";
import { clearAlertBadge, refreshAlertBadge } from "./domain/badges";
import "./native.css";
import { restoreBabyTheme } from "./ui";
restoreBabyTheme();
function App() {
  const [me, setMe] = useState<Identity | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [family, setFamily] = useState("");
  const query = new URLSearchParams(location.search);
  const [invite, setInvite] = useState(query.get("invite") ?? "");
  const [reset, setReset] = useState(query.get("reset") ?? "");
  const [joining, setJoining] = useState(false);
  async function refresh() {
    try {
      const identity = await api("/me");
      setMe(identity);
      const selected =
        identity.families.find((f: any) => f.id === query.get("family"))?.id ??
        identity.families[0]?.id ??
        "";
      setFamily(selected);
      configureCloud(identity, selected);
      localStorage.setItem("baby-last-identity", JSON.stringify(identity));
    } catch (e: any) {
      if (e.status !== 401 && e.status !== 403) {
        const cached = localStorage.getItem("baby-last-identity");
        if (cached) {
          const identity = JSON.parse(cached);
          setMe(identity);
          setFamily(identity.families[0]?.id ?? "");
          configureCloud(identity, identity.families[0]?.id ?? "");
        } else setError("Could not reach the server. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (query.get("demo") === "1") {
      setBusy(false);
      return;
    }
    void refresh();
    const lost = () => {
      clearCloud();
      void clearAlertBadge();
      localStorage.removeItem("baby-last-identity");
      setMe(null);
      setError("Please sign in again to verify household access.");
    };
    window.addEventListener("baby:unauthorized", lost);
    return () => window.removeEventListener("baby:unauthorized", lost);
  }, []);
  useEffect(() => {
    if (!me) return;
    return watchReconnection(async () => {
      await Promise.all([sync(), refreshAlertBadge()]);
    });
  }, [me]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (reset) {
        await api("/reset", { ...data, reset });
        setReset("");
        history.replaceState(null, "", "/");
        setError("Password updated. Please sign in.");
      } else {
        await api(invite && !joining ? "/activate" : "/login", {
          ...data,
          invite,
        });
        if (invite && joining) await api("/join", { invite });
        history.replaceState(null, "", "/");
        setInvite("");
        await refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (query.get("demo") === "1") return <Prototype />;
  if (me && family) {
    configureCloud(me, family);
    return <Prototype key={family} />;
  }
  return (
    <main className="auth-page">
      <h1>
        Did I Feed
        <br />
        My Baby?
      </h1>
      <p>
        A little less remembering.
        <br />A little more being there.
      </p>
      <h2>
        {reset
          ? "Reset password"
          : invite && !joining
            ? "Set up your household access"
            : "Welcome back"}
      </h2>
      <form onSubmit={submit}>
        {invite && !joining && (
          <label>
            Your name
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        )}
        {!reset && (
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
        )}
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={(invite && !joining) || reset ? 12 : 1}
            maxLength={256}
            autoComplete={
              invite && !joining ? "new-password" : "current-password"
            }
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : reset
              ? "Update password"
              : invite && !joining
                ? "Create account"
                : "Sign in"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {invite && (
        <button onClick={() => setJoining(!joining)}>
          {joining
            ? "Create a new account"
            : "Already have an account? Sign in to join"}
        </button>
      )}
      {!invite && !reset && (
        <>
          <p>
            <a href="/?demo=1">Try the local demo</a>
          </p>
          <p>
            Your administrator provides your family activation link. Ask your
            household owner for a caregiver invitation.
          </p>
          <p>Forgot your password? Ask your administrator for a reset link.</p>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
