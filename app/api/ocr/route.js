export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { imageBase64 } = body || {};
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return Response.json({ error: "Missing imageBase64." }, { status: 400 });
  }

  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OCR_SPACE_API_KEY is not configured on the server. Add it to .env.local." },
      { status: 500 }
    );
  }

  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("base64Image", imageBase64);
  params.set("language", "eng");
  params.set("OCREngine", "2"); // engine 2 handles small/printed text more reliably than the default
  params.set("scale", "true"); // let OCR.space upscale if the image is small
  params.set("isOverlayRequired", "true"); // gives per-word bounding boxes back

  let ocrRes;
  try {
    ocrRes = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch {
    return Response.json({ error: "Could not reach the OCR service." }, { status: 502 });
  }

  let data;
  try {
    data = await ocrRes.json();
  } catch {
    return Response.json({ error: "OCR service returned an unexpected response." }, { status: 502 });
  }

  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join("; ") : data.ErrorMessage;
    return Response.json({ error: msg || "OCR processing failed." }, { status: 502 });
  }

  const result = data.ParsedResults && data.ParsedResults[0];
  const text = result ? result.ParsedText || "" : "";
  const lines = (result && result.TextOverlay && result.TextOverlay.Lines) || [];

  return Response.json({ text, lines });
}