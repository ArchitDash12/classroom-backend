import arcjet, { detectBot, shield, slidingWindow } from "@arcjet/node";

if (!process.env.ARCJET_KEY && process.env.NODE_ENV !== "test") {
  throw new Error("ARCJET_KEY env is required");
}

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ["userId"],
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE" ,
      allow: [
        "CATEGORY:SEARCH_ENGINE",
        "CATEGORY:MONITOR",
        "CATEGORY:PREVIEW",
      ],
    }),
  ],
});

const rateLimitClients = new Map<number, ReturnType<typeof aj.withRule>>();

export const getRateLimitClient = (limit: number) => {
  const existing = rateLimitClients.get(limit);

  if (existing) {
    return existing;
  }

  const client = aj.withRule(
    slidingWindow({
      mode: "LIVE",
      interval: "1m",
      max: limit,
    })
  );

  rateLimitClients.set(limit, client);
  return client;
};

export default aj;