"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { extractCandidate, isValidId, normalize } from "@/lib/extract";
import { fmtRelative, fmtTimestamp, isToday } from "@/lib/format";
import { CamIcon, WarnIcon, CheckIcon, FlipIcon, RefreshIcon, ExportIcon, ListIcon } from "@/components/Icons";

const DUP_WINDOW_MS = 5 * 60 * 1000;

export default function Page() {
  const [tab, setTab] = useState("scan");
  const [entries, setEntries] = useState([]);
  const [roster, setRoster] = useState([]);
  const [clock, setClock] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState("environment");
  const [multipleCams, setMultipleCams] = useState(false);
  const [captured, setCaptured] = useState(null);
  const [capturedSize, setCapturedSize] = useState(null); // {width, height} of the captured frame in px
  const [matchBox, setMatchBox] = useState(null); // {leftPct, topPct, widthPct, heightPct} of the detected number, if found

  const [ocrLoading, setOcrLoading] = useState(false);

  const [resultVisible, setResultVisible] = useState(false);
  const [resultValue, setResultValue] = useState("");
  const [dupWarning, setDupWarning] = useState(null);
  const [confirmForce, setConfirmForce] = useState(false);

  const [manualValue, setManualValue] = useState("");
  const [manualForce, setManualForce] = useState(false);
  const [manualDupText, setManualDupText] = useState("");

  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameGuideRef = useRef(null);

  // Clock
  useEffect(() => {
    const update = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance", { cache: "no-store" });
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      // keep whatever is currently in state
    }
  }, []);

  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch("/api/students", { cache: "no-store" });
      const data = await res.json();
      setRoster(Array.isArray(data.students) ? data.students : []);
    } catch {
      // keep whatever is currently in state
    }
  }, []);

  const rosterMap = useMemo(() => {
    const map = new Map();
    for (const s of roster) map.set(s.studentNumber, s);
    return map;
  }, [roster]);

  const findStudent = useCallback(
    (sn) => (sn ? rosterMap.get(normalize(sn)) || null : null),
    [rosterMap]
  );

  useEffect(() => {
    loadEntries();
    loadRoster();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }

  async function startCamera(mode) {
    stopCamera();
    setCameraError("");

    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setCameraError(
        "Camera access requires HTTPS (or localhost). This page is loaded over plain HTTP, so the browser won't allow it."
      );
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "This browser isn't exposing camera access on this page — usually because it's not loaded over HTTPS. Try opening the app via an https:// URL."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode || facingMode } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMultipleCams(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setCameraError(err && err.message ? err.message : "Permission denied or no camera found.");
      setCameraOn(false);
    }
  }

  function flipCamera() {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  }

  // Maps OCR.space's overlay response (Lines[].Words[], each with
  // Left/Top/Width/Height in px relative to the submitted image) into the
  // same flat { text, bbox: {x0,y0,x1,y1} } shape we use for matching.
  function flattenOcrSpaceLines(ocrLines) {
    const words = [];
    const lines = [];
    for (const line of ocrLines || []) {
      const lineWords = line.Words || [];
      for (const w of lineWords) {
        if (!w.WordText) continue;
        words.push({
          text: w.WordText,
          bbox: { x0: w.Left, y0: w.Top, x1: w.Left + w.Width, y1: w.Top + w.Height },
        });
      }
      if (lineWords.length) {
        const x0 = Math.min(...lineWords.map((w) => w.Left));
        const y0 = Math.min(...lineWords.map((w) => w.Top));
        const x1 = Math.max(...lineWords.map((w) => w.Left + w.Width));
        const y1 = Math.max(...lineWords.map((w) => w.Top + w.Height));
        lines.push({ text: lineWords.map((w) => w.WordText).join(""), bbox: { x0, y0, x1, y1 } });
      }
    }
    return { words, lines };
  }

  // OCR.space's free tier caps request images at 1MB. Re-encode at
  // decreasing JPEG quality until we're comfortably under that.
  function canvasToBoundedDataUrl(canvas, maxBytes = 900_000) {
    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length * 0.75 > maxBytes && quality > 0.35) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  }

  // Grayscale + contrast stretch to cut through glare/reflections on the
  // laminated card surface before sending the frame off for OCR.
  function enhanceForOcr(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const gray = new Uint8ClampedArray(width * height);

    let min = 255;
    let max = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      gray[p] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }

    const range = Math.max(1, max - min);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Stretch the observed range to full 0-255 contrast.
      const v = ((gray[p] - min) / range) * 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  async function captureAndScan() {
    const video = videoRef.current;
    if (!video) return;

    // Full-frame capture: shown to the user as-is, and also what we send for
    // OCR — no hard crop to the guide box, since that fails whenever the
    // card isn't perfectly aligned inside it. We scan the whole frame and
    // search word-by-word for the ID pattern.
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = video.videoWidth || 720;
    fullCanvas.height = video.videoHeight || 960;
    fullCanvas.getContext("2d").drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
    const dataUrl = fullCanvas.toDataURL("image/jpeg", 0.92);

    setCaptured(dataUrl);
    setCapturedSize({ width: fullCanvas.width, height: fullCanvas.height });
    setMatchBox(null);
    // Camera stream is intentionally left running — we just overlay the
    // captured still on top of it. This keeps the camera "hot" for the next
    // scan instead of re-requesting getUserMedia every time.
    setResultVisible(false);
    setDupWarning(null);
    setConfirmForce(false);
    setToast(null);
    setOcrLoading(true);

    try {
      // Send canvas: same frame, contrast-enhanced to cut through glare on
      // the laminated card, re-encoded to stay under the free tier's 1MB
      // request limit. No manual upscaling — OCR.space's `scale` option
      // handles that server-side.
      const sendCanvas = document.createElement("canvas");
      sendCanvas.width = fullCanvas.width;
      sendCanvas.height = fullCanvas.height;
      const ctx = sendCanvas.getContext("2d");
      ctx.drawImage(fullCanvas, 0, 0);
      enhanceForOcr(ctx, sendCanvas.width, sendCanvas.height);
      const sendDataUrl = canvasToBoundedDataUrl(sendCanvas);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: sendDataUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setToast({ type: "warn", text: data.error || "OCR request failed — enter the number manually." });
        setResultValue("");
        setOcrLoading(false);
        setResultVisible(true);
        return;
      }

      const { words, lines } = flattenOcrSpaceLines(data.lines);

      let candidate = "";
      let bbox = null;

      // Try the tightest match first: a single recognized word.
      for (const w of words) {
        const c = extractCandidate(w.text);
        if (c) {
          candidate = c;
          bbox = w.bbox;
          break;
        }
      }

      // Next: a whole line's text with spaces stripped, in case the number
      // got split into two "words" by the OCR engine.
      if (!candidate) {
        for (const l of lines) {
          const c = extractCandidate(l.text);
          if (c) {
            candidate = c;
            bbox = l.bbox;
            break;
          }
        }
      }

      // Last resort: whatever flat text came back, no bbox to show.
      if (!candidate) {
        candidate = extractCandidate(data.text || "");
      }

      if (bbox) {
        setMatchBox({
          leftPct: (bbox.x0 / sendCanvas.width) * 100,
          topPct: (bbox.y0 / sendCanvas.height) * 100,
          widthPct: ((bbox.x1 - bbox.x0) / sendCanvas.width) * 100,
          heightPct: ((bbox.y1 - bbox.y0) / sendCanvas.height) * 100,
        });
      }

      setResultValue(candidate);
    } catch {
      setToast({ type: "warn", text: "Network error reaching the OCR service — enter the number manually." });
      setResultValue("");
    } finally {
      setOcrLoading(false);
      setResultVisible(true);
    }
  }

  function retake() {
    setCaptured(null);
    setCapturedSize(null);
    setMatchBox(null);
    setResultVisible(false);
    setDupWarning(null);
    setConfirmForce(false);
    // If the stream ever did drop (e.g. camera was never started, or the OS
    // killed it), this brings it back; otherwise it's a no-op restart.
    if (!streamRef.current) startCamera();
  }

  function findRecentDuplicate(sn) {
    const now = Date.now();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.studentNumber === sn && now - new Date(e.timestamp).getTime() < DUP_WINDOW_MS) {
        return e;
      }
    }
    return null;
  }

  async function submitEntry(sn) {
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentNumber: sn }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: "warn", text: err.error || "Could not save entry." });
        return false;
      }
      const data = await res.json();
      setEntries((prev) => [...prev, data.entry]);
      return true;
    } catch {
      setToast({ type: "warn", text: "Network error — could not save entry." });
      return false;
    }
  }

  function onLoggedSuccess(sn) {
    setResultVisible(false);
    setCaptured(null);
    setCapturedSize(null);
    setMatchBox(null);
    setDupWarning(null);
    setConfirmForce(false);
    setManualValue("");
    setManualForce(false);
    setManualDupText("");
    setToast({ type: "success", text: `${sn} logged at ${new Date().toLocaleTimeString()}` });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleConfirm() {
    const sn = resultValue;
    if (!isValidId(sn)) return;
    if (!confirmForce) {
      const dup = findRecentDuplicate(sn);
      if (dup) {
        const mins = Math.max(1, Math.round((Date.now() - new Date(dup.timestamp).getTime()) / 60000));
        setDupWarning({ studentNumber: sn, mins });
        setConfirmForce(true);
        return;
      }
    }
    const ok = await submitEntry(sn);
    if (ok) onLoggedSuccess(sn);
  }

  async function handleManualConfirm() {
    const sn = manualValue;
    if (!isValidId(sn)) return;
    if (!manualForce) {
      const dup = findRecentDuplicate(sn);
      if (dup) {
        const mins = Math.max(1, Math.round((Date.now() - new Date(dup.timestamp).getTime()) / 60000));
        setManualDupText(`${sn} was logged ${mins} min ago. Tap again to log anyway.`);
        setManualForce(true);
        return;
      }
    }
    const ok = await submitEntry(sn);
    if (ok) onLoggedSuccess(sn);
  }

  function exportCsv() {
    const rows = ["Student Number,Timestamp"];
    entries
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .forEach((e) => rows.push(`${e.studentNumber},${e.timestamp}`));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const filteredEntries = entries
    .filter((e) => (search ? e.studentNumber.includes(normalize(search)) : true))
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const todayCount = entries.filter((e) => isToday(e.timestamp)).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Image src="/facts-logo.png" alt="FACTS logo" width={36} height={36} className="brand-logo" priority />
          <div className="brand-text">
            <span className="eyebrow">FACTS · ID Scan</span>
            <h1>Attendance</h1>
          </div>
        </div>
        <div className="clock">{clock}</div>
      </header>

      <main>
        {tab === "scan" ? (
          <section>
            <div className="viewfinder">
              {!cameraOn && !captured && (
                <div className="placeholder">
                  {cameraError ? <WarnIcon /> : <CamIcon />}
                  <div>
                    <div className="ph-title">{cameraError ? "Camera unavailable" : "Camera is off"}</div>
                    <p>
                      {cameraError
                        ? `${cameraError} You can still enter numbers manually.`
                        : "Start the camera to scan a student ID"}
                    </p>
                  </div>
                </div>
              )}

              {/* video stays mounted so the ref is ready before getUserMedia resolves */}
              <video ref={videoRef} playsInline autoPlay muted className={cameraOn && !captured ? "" : "hidden"} />

              {captured && (
                <div
                  className="still-wrap"
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: capturedSize ? `${capturedSize.width} / ${capturedSize.height}` : undefined,
                  }}
                >
                  <img
                    src={captured}
                    alt="Captured ID"
                    className="still"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                  {matchBox && (
                    <div
                      className="match-box"
                      style={{
                        position: "absolute",
                        left: `${matchBox.leftPct}%`,
                        top: `${matchBox.topPct}%`,
                        width: `${matchBox.widthPct}%`,
                        height: `${matchBox.heightPct}%`,
                        border: "2px solid #22c55e",
                        borderRadius: 4,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.15)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              )}

              {cameraOn && !captured && (
                <div className="frame-guide" ref={frameGuideRef}>
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                </div>
              )}
              {cameraOn && !captured && <div className="guide-text">Align ID inside frame</div>}
              {ocrLoading && <div className="scanline" />}
              {cameraOn && !captured && multipleCams && (
                <button className="flip-btn" onClick={flipCamera} aria-label="Switch camera">
                  <FlipIcon />
                </button>
              )}
            </div>

            {!cameraOn && !captured && (
              <div className="stack">
                <button className="btn btn-primary" onClick={() => startCamera()}>
                  <CamIcon size={17} /> Start camera
                </button>
              </div>
            )}

            {cameraOn && !captured && (
              <div className="stack">
                <button className="btn btn-primary" onClick={captureAndScan}>
                  Capture &amp; scan ID
                </button>
              </div>
            )}

            {ocrLoading && (
              <div className="status-line">
                <span className="spinner" />
                <span>Reading ID…</span>
              </div>
            )}

            {resultVisible && (
              <div className="stack">
                <div className="result-card">
                  <div className="result-label">
                    {resultValue ? "Detected student number — check it's correct" : "Couldn't auto-detect a number — enter or fix it"}
                  </div>
                  <input
                    className={`result-input ${resultValue && !isValidId(resultValue) ? "invalid" : ""}`}
                    maxLength={11}
                    value={resultValue}
                    placeholder="S20XXXXXXXX"
                    onChange={(e) => {
                      setResultValue(normalize(e.target.value));
                      setDupWarning(null);
                      setConfirmForce(false);
                    }}
                  />
                  {resultValue.length > 0 && (
                    <div className={`validity-msg ${isValidId(resultValue) ? "ok" : "bad"}`}>
                      {isValidId(resultValue) ? "Valid format" : "Expected format S20 + 8 digits (e.g. S2012345678)"}
                    </div>
                  )}
                </div>

                {isValidId(resultValue) && (
                  (() => {
                    const student = findStudent(resultValue);
                    return student ? (
                      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
                        <div style={{ fontWeight: 600 }}>{student.name}</div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                          {student.course}
                          {student.course && student.yearLevel ? " • " : ""}
                          {student.yearLevel}
                        </div>
                      </div>
                    ) : (
                      <div className="notice warn">
                        <WarnIcon size={16} />
                        <span>Not found in the student roster — double-check the number.</span>
                      </div>
                    );
                  })()
                )}

                {dupWarning && (
                  <div className="notice warn">
                    <WarnIcon size={16} />
                    <span>
                      {dupWarning.studentNumber} was already logged {dupWarning.mins} min ago. Tap &quot;Log anyway&quot; to log again.
                    </span>
                  </div>
                )}

                <div className="btn-row">
                  <button className="btn btn-secondary" onClick={retake}>
                    Retake
                  </button>
                  <button className="btn btn-success" disabled={!isValidId(resultValue)} onClick={handleConfirm}>
                    {confirmForce ? "Log anyway" : "Log attendance"}
                  </button>
                </div>

              </div>
            )}

            <div className="stack">
              <div className="result-card">
                <div className="result-label">Manual attendance entry</div>

                <input
                  className={`result-input ${
                    manualValue && !isValidId(manualValue) ? "invalid" : ""
                  }`}
                  maxLength={11}
                  value={manualValue}
                  placeholder="S20XXXXXXXX"
                  onChange={(e) => {
                    setManualValue(normalize(e.target.value));
                    setManualForce(false);
                    setManualDupText("");
                  }}
                />

                {manualValue.length > 0 && (
                  <div
                    className={`validity-msg ${
                      isValidId(manualValue) ? "ok" : "bad"
                    }`}
                  >
                    {isValidId(manualValue)
                      ? "Valid format"
                      : "Expected format S20 + 8 digits"}
                  </div>
                )}

                {isValidId(manualValue) &&
                  (() => {
                    const student = findStudent(manualValue);

                    return student ? (
                      <div
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          background: "rgba(34,197,94,0.08)",
                          border: "1px solid rgba(34,197,94,0.25)",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{student.name}</div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                          {student.course}
                          {student.course && student.yearLevel ? " • " : ""}
                          {student.yearLevel}
                        </div>
                      </div>
                    ) : (
                      <div className="notice warn">
                        <WarnIcon size={16} />
                        <span>
                          Not found in the student roster — double-check the number.
                        </span>
                      </div>
                    );
                  })()}

                {manualDupText && (
                  <div className="notice warn">
                    <WarnIcon size={16} />
                    <span>{manualDupText}</span>
                  </div>
                )}

                <div className="btn-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setManualValue("");
                      setManualForce(false);
                      setManualDupText("");
                    }}
                  >
                    Clear
                  </button>

                  <button
                    className="btn btn-success"
                    disabled={!isValidId(manualValue)}
                    onClick={handleManualConfirm}
                  >
                    {manualForce ? "Log anyway" : "Log attendance"}
                  </button>
                </div>
              </div>
            </div>

            {toast && (
              <div className={`notice ${toast.type === "success" ? "success" : "warn"}`} style={{ marginTop: 14 }}>
                {toast.type === "success" ? <CheckIcon size={16} /> : <WarnIcon size={16} />}
                <span>{toast.text}</span>
              </div>
            )}
          </section>
        ) : (
          <section>
            <div className="shared-note">
              <span className="dot" /> Shared log — stored on the server, visible to everyone using this app
            </div>

            <div className="stats-row">
              <div className="stat">
                <div className="num">{entries.length}</div>
                <div className="lbl">Total scans</div>
              </div>
              <div className="stat">
                <div className="num">{todayCount}</div>
                <div className="lbl">Today</div>
              </div>
            </div>

            <div className="log-toolbar">
              <input
                className="search-input"
                placeholder="Search student number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="icon-btn" onClick={loadEntries} aria-label="Refresh">
                <RefreshIcon />
              </button>
              <button className="icon-btn" onClick={exportCsv} aria-label="Export CSV">
                <ExportIcon />
              </button>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="empty-state">
                <ListIcon />
                <p>No attendance records yet</p>
              </div>
            ) : (
              filteredEntries.map((e) => {
                const student = findStudent(e.studentNumber);
                return (
                  <div className="entry" key={e.id || `${e.timestamp}-${e.studentNumber}`}>
                    <div>
                      <div className="sid">{e.studentNumber}</div>
                      {student ? (
                        <div className="meta">
                          {student.name} · {student.course}
                          {student.yearLevel ? ` ${student.yearLevel}` : ""}
                        </div>
                      ) : (
                        <div className="meta">Not in roster</div>
                      )}
                      <div className="meta">{fmtTimestamp(e.timestamp)}</div>
                    </div>
                    <div className="rel">{fmtRelative(e.timestamp)}</div>
                  </div>
                );
              })
            )}
          </section>
        )}
      </main>

      <nav className="tabbar">
        <button className={tab === "scan" ? "active" : ""} onClick={() => setTab("scan")}>
          <CamIcon size={20} />
          Scan
        </button>
        <button
          className={tab === "log" ? "active" : ""}
          onClick={() => {
            setTab("log");
            loadEntries();
          }}
        >
          <ListIcon size={20} />
          Log
        </button>
      </nav>
    </div>
  );
}