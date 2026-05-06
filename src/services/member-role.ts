import { getCollection } from "../lib/mongodb";
import { GroupMemberDocument, MemberRole } from "../types/mongodb";
import { lineClient } from "./line-client";

export class MemberRoleService {
  async getMemberRole(groupId: string, userId: string): Promise<MemberRole> {
    const members = await getCollection<GroupMemberDocument>("group_members");
    const member = await members.findOne({ groupId, userId });
    return member?.role ?? "member";
  }

  async isAdmin(groupId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(groupId, userId);
    return role === "admin";
  }

  async isStaffOrAdmin(groupId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(groupId, userId);
    return role === "staff" || role === "admin";
  }

  async assignRole(
    groupId: string,
    userId: string,
    role: MemberRole,
    assignedBy?: string
  ): Promise<void> {
    const members = await getCollection<GroupMemberDocument>("group_members");
    const profile = await lineClient.getUserProfile(userId);

    await members.updateOne(
      { groupId, userId },
      {
        $set: {
          groupId,
          userId,
          displayName: profile?.displayName,
          role,
          assignedBy,
          assignedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  async removeRole(groupId: string, userId: string): Promise<void> {
    const members = await getCollection<GroupMemberDocument>("group_members");
    await members.deleteOne({ groupId, userId });
  }

  async listGroupMembers(
    groupId: string
  ): Promise<Array<{ userId: string; displayName?: string; role: MemberRole }>> {
    const members = await getCollection<GroupMemberDocument>("group_members");
    const docs = await members.find({ groupId }).toArray();
    return docs.map((doc) => ({
      userId: doc.userId,
      displayName: doc.displayName,
      role: doc.role,
    }));
  }

  async syncGroupMembers(groupId: string): Promise<void> {
    const memberIds = await lineClient.getGroupMemberIds(groupId);
    const members = await getCollection<GroupMemberDocument>("group_members");

    for (const userId of memberIds) {
      const profile = await lineClient.getUserProfile(userId);
      if (profile) {
        await members.updateOne(
          { groupId, userId },
          {
            $set: {
              groupId,
              userId,
              displayName: profile.displayName,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
    }
  }
}

export const memberRoleService = new MemberRoleService();
