import { z } from "zod";
import { idSchema } from "./base";

export const smartLockAccessJobSchema = z.object({
  accountId: idSchema,
  reservationId: idSchema,
});

export type SmartLockAccessJob = z.infer<typeof smartLockAccessJobSchema>;
