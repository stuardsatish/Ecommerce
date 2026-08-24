// Port of functions/routes/payment.js POST /webhook.
// Razorpay -> server-to-server callback, no Supabase JWT — verified purely
// via the webhook secret + raw body HMAC. Finalizes the order even if the
// customer's browser dropped before calling /payment-verify. Configure in
// Razorpay Dashboard -> Webhooks; set RAZORPAY_WEBHOOK_SECRET as a secret.
import { handlePreflight, methodNotAllowed, rawResponse, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";
import { finalizeOrder, NoPendingError } from "../_shared/finalizeOrder.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!secret) {
      console.error("[payment-webhook] webhook secret not configured");
      return rawResponse(req, 500, "webhook not configured");
    }
    const signature = req.headers.get("x-razorpay-signature");
    const { raw, json: body } = await readBody(req);
    if (!raw || !signature) {
      return rawResponse(req, 400, "missing signature/body");
    }

    const verified = await verifyWebhookSignature(raw, signature);
    if (!verified) {
      return rawResponse(req, 400, "invalid signature");
    }

    const event = body?.event;
    if (event === "payment.captured" || event === "order.paid") {
      const payment = body?.payload?.payment?.entity || {};
      const orderId = payment.order_id;
      const paymentId = payment.id;
      if (orderId && paymentId) {
        try {
          await finalizeOrder(admin, orderId, paymentId);
        } catch (e) {
          // No pending record → nothing to do; anything else is real.
          if (!(e instanceof NoPendingError)) throw e;
        }
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[payment-webhook] error:", err);
    return rawResponse(req, 500, "error");
  }
});