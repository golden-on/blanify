import { Worker } from "bullmq";
import { connection } from "./connection";

const worker = new Worker(
  "default",
  async () => {
    // Placeholder job processor — implemented per feature spec.
  },
  { connection },
);

worker.on("ready", () => {
  console.log("Queue worker ready");
});
