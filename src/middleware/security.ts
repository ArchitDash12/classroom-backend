import type { NextFunction, Request, Response } from "express";
import { getRateLimitClient } from "../config/arcjet.js";

const securityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (process.env.NODE_ENV === "test") return next();

  try {
    const user = (req as Request & {
      user?: { id?: string; role?: RateLimitRole };
    }).user;
    const role: RateLimitRole = user?.role ?? "guest";

    const isDev = process.env.NODE_ENV !== "production";
    let limit: number;
    let message: string;

    switch (role) {
      case "admin":
        limit = isDev ? 300 : 20;
        message = "Admin request limit exceeded. Slow down.";
        break;
      case "teacher":
      case "student":
        limit = isDev ? 200 : 10;
        message = "User request limit exceeded. Please wait.";
        break;
      default:
        limit = isDev ? 200 : 10;
        message = "Guest request limit exceeded. Please sign up for higher limit.";
        break;
    }

    const client = getRateLimitClient(limit);
    const decision = await client.protect(req, {
      userId: user?.id ?? req.ip ?? "guest",
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("Arcjet decision", {
        path: req.originalUrl || req.url,
        userId: user?.id ?? req.ip ?? "guest",
        denied: decision.isDenied(),
        reason: decision.reason,
        results: decision.results?.length ?? 0,
      });
    }

    if (decision.isDenied() && decision.reason.isBot()) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Bot traffic is not allowed",
      });
    }

    if (decision.isDenied() && decision.reason.isShield()) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Request blocked by security policy",
      });
    }

    if (decision.isDenied() && decision.reason.isRateLimit()) {
      return res.status(429).json({
        error: "Too many requests",
        message,
      });
    }

    next();
  } catch (error) {
    console.error("Arcjet middleware error:", error);
    // Don't crash in dev if arcjet encounters network issues
    if (process.env.NODE_ENV !== "production") {
      return next();
    }
    res.status(500).json({
      error: "Internal Error",
      message: "Something went wrong with security middleware",
    });
  }
};

export default securityMiddleware;
