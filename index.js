import express from "express";
import chalk from "chalk";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import { instrument } from "@socket.io/admin-ui";
import { UserAuthRoutes } from "./controller/auth/auth.js";
import { connectDB } from "./kitchensink/mongoConnect.js";
import { configDotenv } from "dotenv";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { socketAuthMiddleware } from "./middleware/socketAuthMiddleware.js";
import { AuctionRoutes } from "./routes/auction.js";
import { AuctionModel } from "./models/auction.js";
import { startAuctionScheduler } from "./schedulers/schedulers.js";
configDotenv();
const app = express();
const server = createServer(app);
app.use(cookieParser());

app.use(morgan("dev"));
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://bidding-frontend-hggx.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH"],
    credentials: true,
  })
);
connectDB();

app.get("/api", (req, res) => {
  res.status(200).json({ status: true, message: "Backend is working !!" });
});

app.use("/api/v1/auth", UserAuthRoutes);
app.use("/api/v1/auction", AuctionRoutes);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://bidding-frontend-hggx.vercel.app",
      "https://bidding-frontend-kappa.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("joinAuctionRoom", (auctionId) => {
    if (!auctionId) return;
    const roomName = `auction-${auctionId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });

  socket.on("leaveAuctionRoom", (auctionId) => {
    if (!auctionId) return;
    const roomName = `auction-${auctionId}`;
    socket.leave(roomName);
    console.log(`Socket ${socket.id} left room ${roomName}`);
  });

  // --- Handle Bid Placement ---
  socket.on("place-bid", async (payload) => {
    console.log(`Socket ${socket.id} attempting to place bid:`, payload);
    const {
      bidderId,
      auctionId,
      amount,
      bidderUsername /* optional, can be fetched */,
    } = payload;

    // Basic payload validation
    if (
      !bidderId ||
      !auctionId ||
      amount === undefined ||
      isNaN(parseFloat(amount))
    ) {
      return socket.emit("bid-error", {
        auctionId,
        message: "Invalid bid payload.",
      });
    }

    const numericAmount = parseFloat(amount);

    try {
      const currAuction = await AuctionModel.findById(auctionId);

      if (!currAuction) {
        return socket.emit("bid-error", {
          auctionId,
          message: "Auction Not Found!",
        });
      }

      if (currAuction.status !== "active") {
        return socket.emit("bid-error", {
          auctionId,
          message: "Bidding is not active for this auction.",
        });
      }
      if (new Date(currAuction.endTime) < new Date()) {
        currAuction.status = currAuction.bids.length > 0 ? "sold" : "ended"; // Mark as ended if time passed
        await currAuction.save();
        const room = `auction-${auctionId}`;
        const endedAuction = await AuctionModel.findById(auctionId)
          .populate("createdBy", "username _id")
          .populate("highestBidder", "username _id")
          .populate("bids.bidder", "username _id");
        io.to(room).emit("auctionEnded", {
          auctionId,
          status: currAuction.status,
          data: endedAuction,
        });
        return socket.emit("bid-error", {
          auctionId,
          message: "Auction has already ended.",
        });
      }
      if (
        currAuction.createdBy &&
        currAuction.createdBy.toString() === bidderId
      ) {
        return socket.emit("bid-error", {
          auctionId,
          message: "You cannot bid on your own auction.",
        });
      }
      const minIncrement = currAuction.minimumIncrement || 1;
      const minNextBid = currAuction.currentPrice + minIncrement;
      if (numericAmount < minNextBid) {
        return socket.emit("bid-error", {
          auctionId,
          message: `Bid amount is too low. Minimum next bid is $${minNextBid.toFixed(
            2
          )}.`,
        });
      }
      if (numericAmount <= currAuction.currentPrice) {
        return socket.emit("bid-error", {
          auctionId,
          message: `Bid must be higher than the current price of $${currAuction.currentPrice.toFixed(
            2
          )}.`,
        });
      }

      // --- Update Auction with New Bid ---
      // Assuming your AuctionModel.addBid method handles adding the bid,
      // updating currentPrice, highestBidder, and saving the document.
      // If not, you need to implement that logic here or in the model.

      // Example of direct update if addBid is not a comprehensive method:
      const newBid = {
        bidder: bidderId, // Expecting bidderId to be the User's _id
        amount: numericAmount,
        timestamp: new Date(),
      };
      currAuction.bids.push(newBid);
      // Optional: sort bids if you want the latest to appear first or by amount
      // currAuction.bids.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      currAuction.currentPrice = numericAmount;
      currAuction.highestBidder = bidderId; // Expecting bidderId to be the User's _id

      await currAuction.save();
      // --- End of direct update example ---

      // --- Fetch the fully populated auction to broadcast ---
      const updatedAuctionForBroadcast = await AuctionModel.findById(auctionId)
        .populate("createdBy", "username _id email") // Add fields you need
        .populate("highestBidder", "username _id email")
        .populate({
          path: "bids.bidder",
          select: "username _id email", // Select fields for bidders in the bids array
        });

      if (!updatedAuctionForBroadcast) {
        // Should be rare if save was successful but handle it
        console.error(`Failed to re-fetch auction ${auctionId} after bid.`);
        return socket.emit("bid-error", {
          auctionId,
          message: "Error updating auction details after bid.",
        });
      }

      // 1. Acknowledge the bidding user directly
      socket.emit("bid-placed-successfully", {
        auctionId,
        message: `Your bid of $${numericAmount.toFixed(
          2
        )} was placed successfully!`,
        // You can send back the specific new bid object or the updated auction
        // newBid: newBid, // If you want to send just the new bid details
        updatedAuction: updatedAuctionForBroadcast, // Sending full updated auction can be simpler
      });

      // 2. Broadcast the updated auction to everyone in the room
      const roomName = `auction-${auctionId}`;
      io.to(roomName).emit("auction-updated", updatedAuctionForBroadcast);

      console.log(
        `Bid successful for auction ${auctionId}. Updated auction emitted to room ${roomName}.`
      );
    } catch (error) {
      console.error(
        `Error processing bid for auction ${auctionId} by socket ${socket.id}:`,
        error
      );
      socket.emit("bid-error", {
        auctionId,
        message:
          error.message ||
          "An unexpected server error occurred during bidding.",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    // Socket.IO automatically handles removing the socket from all rooms it was in.
    // You might add custom cleanup logic here if needed (e.g., tracking active users).
  });
});

io.on("error", (err) => {
  console.log("Error Occured !!", err);
});

server.listen(8080, () => {
  startAuctionScheduler(io);
  console.log(chalk.bgBlue("Server Is Running at 8080"));
});
