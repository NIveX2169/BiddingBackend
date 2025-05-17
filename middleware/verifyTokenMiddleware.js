// middleware/verifyToken.js (or your authMiddleware.js)
import jwt from "jsonwebtoken";
import { configDotenv } from "dotenv";
import chalk from "chalk";

configDotenv(); // Ensure environment variables are loaded

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error(
    "FATAL ERROR: JWT_SECRET is not defined in environment variables."
  );
}

export const verifyToken = async (req, res, next) => {
  const { accessToken } = req.cookies;
  console.log(chalk.bgYellowBright(accessToken));
  if (!accessToken) {
    return res.status(401).json({
      status: false,
      message: "Not authorized, no access token provided in cookies.",
    });
  }

  try {
    const decoded = jwt.verify(accessToken, JWT_SECRET);

    if (!decoded.id || !decoded.role) {
      console.warn(
        "Token payload is missing required user information (userId or userRole). Token:",
        decoded
      );
      return res.status(401).json({
        status: false,
        message: "Not authorized, token payload is incomplete.",
      });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
      username: decoded.username,
    };

    next();
  } catch (error) {
    console.error("Token verification error:", error.message);

    if (error.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ status: false, message: "Not authorized, invalid token." });
    }
    if (error.name === "TokenExpiredError") {
      // Token has expired
      return res
        .status(401)
        .json({ status: false, message: "Not authorized, token expired." });
    }

    // For other unexpected errors during verification
    return res.status(401).json({
      status: false,
      message: "Not authorized, token verification failed.",
    });
  }
};
