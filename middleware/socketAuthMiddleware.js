import jwt from "jsonwebtoken";

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return next(new Error("No cookies found"));

    // Manual cookie parsing
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => c.split("="))
    );

    const token = cookies["accessToken"];

    if (!token) {
      console.log("❌ No token found in cookies, rejecting connection.");
      return next(new Error("Authentication error: No token"));
    }

    // Verify JWT token
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.log("❌ Invalid token:", err.message);
        return next(new Error("Authentication error: Invalid token"));
      }

      socket.handshake.user = decoded;
      next(); // Allow connection
    });
  } catch (err) {
    console.error("❌ Error in socket authentication middleware:", err);
    next(new Error("Authentication error"));
  }
};
