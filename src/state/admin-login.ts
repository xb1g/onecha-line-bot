/**
 * Admin Login State Service
 * Manages temporary password input state for admin login
 */

import { getCollection } from "../lib/mongodb";

interface AdminLoginState {
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function setAwaitingAdminPassword(userId: string): Promise<void> {
  const states = await getCollection<AdminLoginState>("admin_login_states");

  // Remove any existing states for this user
  await states.deleteMany({ userId });

  // Create new state that expires in 5 minutes
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await states.insertOne({
    userId,
    createdAt: new Date(),
    expiresAt,
  });
}

export async function getAdminLoginState(
  userId: string,
): Promise<AdminLoginState | null> {
  const states = await getCollection<AdminLoginState>("admin_login_states");
  const state = await states.findOne({ userId });

  if (!state) {
    return null;
  }

  // Check if expired
  if (new Date() > state.expiresAt) {
    await states.deleteOne({ userId });
    return null;
  }

  return state;
}

export async function clearAdminLoginState(userId: string): Promise<void> {
  const states = await getCollection<AdminLoginState>("admin_login_states");
  await states.deleteMany({ userId });
}
