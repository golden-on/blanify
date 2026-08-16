import { z } from "zod";
import { idSchema } from "./base";

export const dashboardChecklistSchema = z.object({
  hasUnits: z.boolean(),
  hasStripeConnected: z.boolean(),
  hasTaxRules: z.boolean(),
  hasWebsitePublished: z.boolean(),
  hasChannelsConnected: z.boolean(),
});

export const dashboardActivityReservationSchema = z.object({
  id: idSchema,
  unitName: z.string().nullable(),
  guestName: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
});

export const dashboardTodaysActivitySchema = z.object({
  checkIns: z.array(dashboardActivityReservationSchema),
  checkOuts: z.array(dashboardActivityReservationSchema),
  currentlyStaying: z.array(dashboardActivityReservationSchema),
});

export const dashboardKpisSchema = z.object({
  activeReservationsCount: z.number().int(),
  occupancyRateThisMonth: z.number(),
  revenueThisMonthInCents: z.number().int(),
  openThreadsCount: z.number().int(),
});

export const dashboardResponseSchema = z.object({
  checklist: dashboardChecklistSchema,
  today: dashboardTodaysActivitySchema,
  kpis: dashboardKpisSchema,
});

export type DashboardChecklist = z.infer<typeof dashboardChecklistSchema>;
export type DashboardActivityReservation = z.infer<typeof dashboardActivityReservationSchema>;
export type DashboardTodaysActivity = z.infer<typeof dashboardTodaysActivitySchema>;
export type DashboardKpis = z.infer<typeof dashboardKpisSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
