// supabase/functions/verify-voice/index.ts
// Deploy: supabase functions deploy verify-voice
//
// Required environment variables (set in Supabase Dashboard → Settings → Edge Functions):
//   SUPABASE_URL          — auto-provided by Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase runtime
//   AZURE_SPEAKER_KEY     — Azure Cognitive Services key (free tier: 10k tx/month)
//   AZURE_SPEAKER_REGION  — e.g. "eastus", "centralindia"
//
// Azure Speaker Recognition free tier setup:
//   1. Go to portal.azure.com → Create resource → "Speaker Recognition"
//   2. Choose Free F0 tier → Copy Key and Region
//   3. Paste into Supabase Dashboard → Settings → Edge Functions → Secrets

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AZURE_ENDPOINT = (region: string) =>
  `https://${region}.api.cognitive.microsoft.com/speaker/verification/v2.0`;

// ─── CORS headers ────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Parse request body ───────────────────────────────────────────────
    const { user_id, recorded_file } = await req.json();

    if (!user_id || !recorded_file) {
      return jsonError("Missing user_id or recorded_file", 400);
    }

    // ── 2. Init Supabase admin client ───────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // ── 3. Fetch the student's enrolled voice sample URL ────────────────────
    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("voice_sample_url, first_name, last_name")
      .eq("user_id", user_id)
      .single();

    if (profileError || !profile) {
      return jsonError("User profile not found", 404);
    }

    if (!profile.voice_sample_url) {
      return jsonError(
        "No voice sample enrolled for this user. Please re-register with a voice sample.",
        422
      );
    }

    // ── 4. Download both audio blobs from Supabase Storage ──────────────────
    //    enrolled sample (stored as full public URL or storage path)
    const enrolledBlob = await downloadFromStorage(
      sb,
      profile.voice_sample_url
    );
    const verifyBlob = await downloadFromStoragePath(
      sb,
      "voice-samples",
      recorded_file
    );

    if (!enrolledBlob || !verifyBlob) {
      return jsonError("Failed to retrieve audio files from storage", 500);
    }

    // ── 5. Run verification ──────────────────────────────────────────────────
    const azureKey = Deno.env.get("AZURE_SPEAKER_KEY");
    const azureRegion = Deno.env.get("AZURE_SPEAKER_REGION");

    let match = false;
    let confidence = "low";
    let score = 0;
    let verificationMode: "azure" | "fallback" = "fallback";

    if (azureKey && azureRegion) {
      // ── Azure Speaker Recognition path ─────────────────────────────────
      const result = await verifyWithAzure(
        azureKey,
        azureRegion,
        enrolledBlob,
        verifyBlob,
        user_id,
        sb
      );
      match = result.match;
      confidence = result.confidence;
      score = result.score;
      verificationMode = "azure";
    } else {
      // ── Fallback heuristic (dev mode) ───────────────────────────────────
      // Not biometric — only use during development/testing
      console.warn(
        "AZURE_SPEAKER_KEY not set — using fallback heuristic. Set up Azure for production."
      );
      const result = await fallbackHeuristic(enrolledBlob, verifyBlob);
      match = result.match;
      confidence = result.confidence;
      score = result.score;
      verificationMode = "fallback";
    }

    // ── 6. Clean up the temporary verify file ────────────────────────────────
    await sb.storage.from("voice-samples").remove([recorded_file]);

    // ── 7. Return result ─────────────────────────────────────────────────────
    return json({ match, confidence, score, verification_mode: verificationMode });
  } catch (err) {
    console.error("verify-voice error:", err);
    return jsonError(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
});

// ─── Azure Speaker Recognition ────────────────────────────────────────────────
// Uses "Text-Independent Verification" — no fixed passphrase needed.
// Azure needs a "profile" per speaker. We store the profile ID in the DB.
async function verifyWithAzure(
  key: string,
  region: string,
  enrolledBlob: Blob,
  verifyBlob: Blob,
  userId: string,
  sb: ReturnType<typeof createClient>
): Promise<{ match: boolean; confidence: string; score: number }> {
  const base = AZURE_ENDPOINT(region);
  const headers = {
    "Ocp-Apim-Subscription-Key": key,
  };

  // ── a. Get or create Azure speaker profile ID ─────────────────────────────
  const { data: profile } = await sb
    .from("profiles")
    .select("azure_speaker_profile_id")
    .eq("user_id", userId)
    .single();

  let profileId: string = profile?.azure_speaker_profile_id || "";

  if (!profileId) {
    // Create a new text-independent verification profile
    const createRes = await fetch(
      `${base}/text-independent/profiles`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en-IN" }),
      }
    );
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Azure create profile failed: ${err}`);
    }
    const created = await createRes.json();
    profileId = created.profileId;

    // Save profile ID so we don't recreate it next time
    await sb
      .from("profiles")
      .update({ azure_speaker_profile_id: profileId })
      .eq("user_id", userId);
  }

  // ── b. Enroll the stored voice sample (idempotent — Azure handles duplicates)
  const enrollRes = await fetch(
    `${base}/text-independent/profiles/${profileId}/enrollments`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": resolveAudioContentType(enrolledBlob),
      },
      body: enrolledBlob,
    }
  );
  if (!enrollRes.ok) {
    const err = await enrollRes.text();
    // Enrollment errors (e.g. short audio) should not crash — log and fallback
    console.warn("Azure enroll warning:", err);
  }

  // ── c. Verify the new recording against the profile ───────────────────────
  const verifyRes = await fetch(
    `${base}/text-independent/profiles/${profileId}/verify`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": resolveAudioContentType(verifyBlob),
      },
      body: verifyBlob,
    }
  );

  if (!verifyRes.ok) {
    const err = await verifyRes.text();
    throw new Error(`Azure verify failed: ${err}`);
  }

  const result = await verifyRes.json();
  // result.result: "Accept" | "Reject"
  // result.score: 0.0 – 1.0
  const match = result.result === "Accept";
  const score = Math.round((result.score || 0) * 100);
  const confidence =
    score >= 75 ? "high" : score >= 50 ? "medium" : "low";

  return { match, confidence, score };
}

// ─── Fallback heuristic (dev only, not biometric) ────────────────────────────
async function fallbackHeuristic(
  enrolled: Blob,
  recorded: Blob
): Promise<{ match: boolean; confidence: string; score: number }> {
  // Dev fallback only (when external biometric provider is not configured):
  // compare coarse audio signatures to reduce false rejections.
  const minBytes = 4_000;
  if (enrolled.size < minBytes || recorded.size < minBytes) {
    return { match: false, confidence: "low", score: 15 };
  }

  try {
    const [a, b] = await Promise.all([buildAudioSignature(enrolled), buildAudioSignature(recorded)]);

    const sizeSimilarity = Math.min(a.size, b.size) / Math.max(a.size, b.size);
    const meanSimilarity = 1 - Math.min(1, Math.abs(a.mean - b.mean) / 255);
    const stdSimilarity = 1 - Math.min(1, Math.abs(a.stdDev - b.stdDev) / 128);
    const zeroSimilarity = 1 - Math.min(1, Math.abs(a.zeroRatio - b.zeroRatio));
    const distributionSimilarity =
      meanSimilarity * 0.45 + stdSimilarity * 0.45 + zeroSimilarity * 0.1;
    const headerSimilarity = prefixSimilarity(a.headerPrefix, b.headerPrefix);

    // Weighted combined score (0-100)
    const combined =
      sizeSimilarity * 0.4 +
      distributionSimilarity * 0.45 +
      headerSimilarity * 0.15;

    const score = Math.max(0, Math.min(100, Math.round(combined * 100)));
    const match = score >= 42;
    const confidence = score >= 70 ? "medium" : "low";
    return { match, confidence, score };
  } catch (err) {
    console.warn("Fallback heuristic failed:", err);
    return { match: false, confidence: "low", score: 0 };
  }
}

function resolveAudioContentType(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  return t.startsWith("audio/") ? t : "application/octet-stream";
}

async function buildAudioSignature(blob: Blob): Promise<{
  size: number;
  mean: number;
  stdDev: number;
  zeroRatio: number;
  headerPrefix: Uint8Array;
}> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sampleCount = Math.min(4096, bytes.length);
  const step = Math.max(1, Math.floor(bytes.length / sampleCount));

  let sum = 0;
  let sumSq = 0;
  let zeros = 0;
  let seen = 0;

  for (let i = 0; i < bytes.length; i += step) {
    const v = bytes[i];
    sum += v;
    sumSq += v * v;
    if (v === 0) zeros++;
    seen++;
  }

  const mean = seen ? sum / seen : 0;
  const variance = seen ? Math.max(0, sumSq / seen - mean * mean) : 0;
  const stdDev = Math.sqrt(variance);
  const zeroRatio = seen ? zeros / seen : 1;
  const headerPrefix = bytes.slice(0, 32);

  return {
    size: blob.size,
    mean,
    stdDev,
    zeroRatio,
    headerPrefix,
  };
}

function prefixSimilarity(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let same = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) same++;
  }
  return same / len;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
async function downloadFromStorage(
  sb: ReturnType<typeof createClient>,
  urlOrPath: string
): Promise<Blob | null> {
  try {
    // If it's a full public URL, fetch directly
    if (urlOrPath.startsWith("http")) {
      const res = await fetch(urlOrPath);
      if (!res.ok) return null;
      return await res.blob();
    }
    // Otherwise treat as storage path
    return downloadFromStoragePath(sb, "voice-samples", urlOrPath);
  } catch {
    return null;
  }
}

async function downloadFromStoragePath(
  sb: ReturnType<typeof createClient>,
  bucket: string,
  path: string
): Promise<Blob | null> {
  try {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Response helpers ─────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return json({ match: false, error: message }, status);
}
