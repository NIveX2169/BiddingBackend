import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["ADMIN", "USER"],
      default: "USER",
    },
    refreshToken: {
      type: String,
    },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare hashed passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  console.log(this.password);
  return await bcrypt.compare(enteredPassword, this.password);
};

export const UserModel = mongoose.model("User", userSchema);
