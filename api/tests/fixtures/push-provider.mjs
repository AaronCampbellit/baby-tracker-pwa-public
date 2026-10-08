// Loaded only by the isolated API regression test. Never contacts a push provider.
import webpush from "web-push";
webpush.sendNotification = async (subscription, payload, options) => {
  process.send?.({
    endpoint: subscription.endpoint,
    payload: JSON.parse(payload),
    options,
  });
  if (subscription.endpoint.endsWith("/expired")) throw { statusCode: 410 };
  if (subscription.endpoint.endsWith("/busy"))
    throw { statusCode: 429, body: "private provider response" };
  return { statusCode: 201 };
};
