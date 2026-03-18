/**
 * Admin Session Service
 * Manages persistent admin sessions stored in MongoDB
 */

import { getCollection } from "../lib/mongodb";

interface AdminSession {
  userId: string;
  createdAt: Date;
  isActive: boolean;
}

export async function createAdminSession(userId: string): Promise<void> {
  const sessions = await getCollection<AdminSession>("admin_sessions");

  // Remove any existing sessions for this user
  await sessions.deleteMany({ userId });

  // Create new session
  await sessions.insertOne({
    userId,
    createdAt: new Date(),
    isActive: true,
  });
}

export async function hasAdminSession(userId: string): Promise<boolean> {
  const sessions = await getCollection<AdminSession>("admin_sessions");
  const session = await sessions.findOne({
    userId,
    isActive: true,
  });

  return !!session;
}

export async function removeAdminSession(userId: string): Promise<void> {
  const sessions = await getCollection<AdminSession>("admin_sessions");
  await sessions.deleteMany({ userId });
}
