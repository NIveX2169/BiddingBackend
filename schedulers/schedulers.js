// scheduler.js (or in server.js)
import cron from "node-cron";
import { AuctionModel } from "../models/auction.js";
import chalk from "chalk";
// You'll need access to your 'io' instance from server.js
// One way is to pass it when you initialize the scheduler

export function startAuctionScheduler(ioInstance) {
  console.log(chalk.cyan("Auction scheduler started."));

  // Schedule a job to run, for example, every minute
  // cron.schedule('* * * * *', async () => { // Every minute
  cron.schedule("*/10 * * * * *", async () => {
    // Every 10 seconds (for easier testing)
    console.log(chalk.yellow("Running auction status check job..."));
    const now = new Date();

    try {
      // --- 1. Find auctions that should START ---
      const auctionsToStart = await AuctionModel.find({
        startTime: { $lte: now }, // Start time is now or in the past
        status: "pending", // And it's still pending
      });

      for (const auction of auctionsToStart) {
        console.log(
          chalk.blue(`Auction ${auction._id} (${auction.title}) should start.`)
        );
        auction.status = "active";
        await auction.save();

        // Fetch populated auction for emitting
        const startedAuction = await AuctionModel.findById(auction._id)
          .populate("createdBy", "username _id")
          .populate("highestBidder", "username _id")
          .populate("bids.bidder", "username _id");

        if (startedAuction) {
          const roomName = `auction-${auction._id}`;
          ioInstance.to(roomName).emit("auctionStarted", {
            auctionId: auction._id,
            status: "active",
            message: `Auction "${startedAuction.title}" is now live!`,
            data: startedAuction, // Send the full updated auction object
          });
          console.log(
            chalk.greenBright(
              `Emitted 'auctionStarted' for ${auction._id} to room ${roomName}`
            )
          );

          // Optional: Notify the creator if they are online and you have user-specific rooms/tracking
          // if (auction.createdBy && activeUsersMap.has(auction.createdBy.toString())) {
          //    const creatorSocketId = activeUsersMap.get(auction.createdBy.toString()).socketId;
          //    ioInstance.to(creatorSocketId).emit('myAuctionStatusChanged', startedAuction);
          // }
        }
      }

      // --- 2. Find auctions that should END ---
      const auctionsToEnd = await AuctionModel.find({
        endTime: { $lte: now }, // End time is now or in the past
        status: "active", // And it's currently active
      });

      for (const auction of auctionsToEnd) {
        console.log(
          chalk.magenta(`Auction ${auction._id} (${auction.title}) should end.`)
        );
        // Determine final status: 'sold' if bids exist, otherwise 'ended'
        auction.status =
          auction.bids && auction.bids.length > 0 ? "sold" : "ended";
        await auction.save();

        // Fetch populated auction for emitting
        const endedAuction = await AuctionModel.findById(auction._id)
          .populate("createdBy", "username _id")
          .populate("highestBidder", "username _id")
          .populate("bids.bidder", "username _id");

        if (endedAuction) {
          const roomName = `auction-${auction._id}`;
          ioInstance.to(roomName).emit("auctionEnded", {
            auctionId: auction._id,
            status: endedAuction.status,
            message: `Auction "${endedAuction.title}" has ${endedAuction.status}.`,
            data: endedAuction, // Send the full updated auction object
          });
          console.log(
            chalk.redBright(
              `Emitted 'auctionEnded' for ${auction._id} (status: ${endedAuction.status}) to room ${roomName}`
            )
          );
        }
      }
    } catch (error) {
      console.error(chalk.red("Error in auction status check job:"), error);
    }
  });
}
