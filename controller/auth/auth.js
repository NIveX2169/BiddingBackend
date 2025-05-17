import express from "express";
import { UserModel } from "../../models/auth.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendVerificationEmail } from "../../utils/sendMail.js";
import { verifyToken } from "../../middleware/verifyTokenMiddleware.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const userExists = await UserModel.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate Verification Token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = Date.now() + 1000 * 60 * 60 * 24; // 24 hours

    // Create User
    const user = await UserModel.create({
      username,
      email,
      password: hashedPassword,
      verificationToken,
      verificationTokenExpires,
    });

    // Send Verification Email
    const verificationLink = `${process.env.BASE_URL}/api/v1/auth/verify-email?token=${verificationToken}&email=${email}`;
    await sendVerificationEmail(email, verificationLink);

    res.status(201).json({
      status: true,
      message:
        "User registered successfully. Please Check Your Email For Verification Link. Check Spam Also!!",
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user && !user.isVerified) {
      return res
        .status(401)
        .json({ message: "Please Do Verify Your Account !!" });
    }

    // Check password
    // const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!user.matchPassword(password)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate Tokens
    const accessToken = jwt.sign(
      {
        id: user._id,
        username: user.username,
        email: user.email,
        isVerified: user.isVerified,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // Increased to 15 minutes
    );

    const refreshToken = jwt.sign(
      {
        id: user._id,
        username: user.username,
        email: user.email,
        isVerified: user.isVerified,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Cookie Settings
    const isProduction = process.env.NODE_ENV == "production";
    res.cookie("accessToken", accessToken, {
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 15 minutes
      httpOnly: true,
      sameSite: isProduction ? "strict" : "lax",
    });
    res.cookie("refreshToken", refreshToken, {
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 7 days
      httpOnly: true,
      sameSite: isProduction ? "strict" : "lax",
    });

    res.json({
      status: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

router.get("/verify-email", async (req, res) => {
  try {
    const { token, email } = req.query;

    // Find user with the token
    const user = await UserModel.findOne({
      email,
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Verify the user
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({
      status: true,
      message: "Email successfully verified. You can now log in.",
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "User is already verified" });
    }

    // Generate a new verification token
    user.verificationToken = crypto.randomBytes(32).toString("hex");
    user.verificationTokenExpires = Date.now() + 1000 * 60 * 60 * 24;
    await user.save();

    // Send new verification email
    const verificationLink = `${process.env.BASE_URL}/api/v1/auth/verify-email?token=${user.verificationToken}&email=${email}`;
    await sendVerificationEmail(email, verificationLink);

    res.status(200).json({
      status: true,
      message: "A new verification link has been sent to your email.",
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

router.get("/logout", (req, res) => {
  try {
    // Clear the cookie that stores the JWT token
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // only in HTTPS
      sameSite: "strict",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // only in HTTPS
      sameSite: "strict",
    });

    res.status(200).json({
      status: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout Error: ", error.message);
    res.status(500).json({
      status: false,
      message: "Server Error during logout",
    });
  }
});

router.route("/getAllUser").get(verifyToken, async (req, res) => {
  if (req.user.role != "ADMIN") {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized Path !!" });
  }
  console.log("huraah");
  const users = await UserModel.find()
    .select(
      "-password -isVerified -refreshToken -verificationTokenExpires -verificationToken"
    )
    .lean();

  return res
    .status(200)
    .json({ status: true, message: "Fetched All Users", data: users });
});

router.patch("/assign-role/:id", verifyToken, async (req, res) => {
  if (req.user.role != "ADMIN") {
    return res
      .status(401)
      .json({ status: false, message: "Unauthorized Path !!" });
  }

  const { id } = req.params;
  const { role } = req.body;
  const users = await UserModel.findByIdAndUpdate(id, {
    role,
  });

  return res.status(200).json({ status: true, message: "User Role Assigned" });
});

export const UserAuthRoutes = router;
