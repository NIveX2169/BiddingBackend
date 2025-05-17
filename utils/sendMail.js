// src/utils/sendEmail.js
import nodemailer from "nodemailer";

export const sendVerificationEmail = async (email, verificationLink) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER, // Your Gmail address
      pass: process.env.EMAIL_PASS, // Your Gmail password or App password
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Verify your email address",
    html: `<p>Click the link below to verify your email address:</p>
           <a href="${verificationLink}">${verificationLink}</a>`,
  };

  await transporter.sendMail(mailOptions);
};
