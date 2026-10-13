import crypto from "crypto";
import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { processPR } from "@/lib/jobs/processPR";

const HANDLED_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

function isValidSignature(rawBody: string, signatureHeader: string, secret: string) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureHeader, "utf8");

  // timingSafeEqual throws if the buffers differ in length, so that has to
  // be checked separately -- it's not itself a timing side-channel since an
  // attacker already knows the expected signature's fixed length.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const signatureHeader = request.headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!signatureHeader || !secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidSignature(rawBody, signatureHeader, secret)) {
    console.warn("Webhook signature verification failed -- possible spoofed request.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(rawBody);

  console.log(`Received webhook event: ${event}`);

  if (event !== "pull_request" || !HANDLED_ACTIONS.has(payload.action)) {
    console.log(`Ignoring event "${event}" / action "${payload.action}" -- not handled.`);
    return NextResponse.json({ received: true, processed: false }, { status: 200 });
  }

  const senderId = String(payload.sender.id);

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.providerAccountId, senderId), eq(accounts.provider, "github")));

  if (!account) {
    console.log(
      `No dashboard account linked to GitHub user ${senderId}; ignoring PR #${payload.pull_request.number}.`
    );
    return NextResponse.json({ received: true, processed: false }, { status: 200 });
  }

  // The actual Playwright/LLM pipeline is heavy and shouldn't hold this
  // response open (or risk GitHub's webhook delivery timeout) -- schedule
  // it to run after the response is sent, and acknowledge receipt now.
  after(async () => {
    await processPR(payload, account.userId);
  });

  return NextResponse.json({ received: true }, { status: 200 });
}
