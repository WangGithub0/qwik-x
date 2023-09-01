import {
  type RequestEventAction,
  type RequestEventLoader,
} from "@builder.io/qwik-city";
import { format, formatDistanceToNowStrict } from "date-fns";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "~/database/connection";
import {
  profile,
  type NewProfile,
  posts,
  type Profile,
} from "~/database/schema";
import { findUserByUsername } from "./users";
import { fetchFollowCount } from "./follow";
import {
  fetchPostLikesCount,
  fetchPostRepliesCount,
  isPostAlreadyLiked,
} from "./posts";
import type { AuthUser } from "~/types";

async function createProfile(values: NewProfile) {
  const data = await db.insert(profile).values(values).returning();
  return data[0];
}
async function updateProfile(userId: number, values: Partial<NewProfile>) {
  const data = await db
    .update(profile)
    .set(values)
    .where(eq(profile.userId, userId))
    .returning();
  return data[0];
}
async function fetchUserProfile({ error, params }: RequestEventLoader) {
  const data = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.username, params.username);
    },
    with: {
      profile: true,
    },
  });
  if (!data) throw error(404, "User not found");

  return {
    ...data,
    profile: {
      ...data.profile,
      createdAt: format(data.profile.createdAt, "MMMM yyyy"),
      dob: data.profile.dob ? format(data.profile.dob, "MMMM d, yyyy") : null,
    },
  };
}
async function fetchProfileFollowCount({ params, error }: RequestEventLoader) {
  const user = await findUserByUsername(params.username);
  if (!user) throw error(404, "User not found");
  const data = await fetchFollowCount(user.id);
  return data;
}
async function fetchProfilePostsCount({ error, params }: RequestEventLoader) {
  const user = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.username, params.username);
    },
  });
  if (!user) throw error(404, "User not found");
  const data = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(posts)
    .where(eq(posts.authorId, user.id));

  return data[0];
}
async function fetchProfileLikedPosts({
  error,
  params,
  sharedMap,
}: RequestEventLoader) {
  const currentUser = sharedMap.get("user");
  const user = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.username, params.username);
    },
  });
  if (!user) throw error(404, "User not found");
  const postsLikes = await db.query.postsLikes.findMany({
    where(fields, { eq }) {
      return eq(fields.userId, user.id);
    },
    with: {
      post: {
        with: {
          author: true,
          parentPost: {
            with: {
              author: {
                columns: {
                  username: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy({ createdAt }, { desc }) {
      return desc(createdAt);
    },
  });

  const formattedPosts = [];
  for (const postLike of postsLikes) {
    formattedPosts.push({
      ...postLike.post,
      isLiked: await isPostAlreadyLiked(postLike.post.id, currentUser?.id),
      createdAt: formatDistanceToNowStrict(postLike.post.createdAt),
      likesCount: await fetchPostLikesCount(postLike.post.id),
      repliesCount: await fetchPostRepliesCount(postLike.post.id),
    });
  }
  return formattedPosts;
}
async function fetchProfilePostsReplies({
  error,
  params,
  sharedMap,
}: RequestEventLoader) {
  const currentUser = sharedMap.get("user");
  const user = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.username, params.username);
    },
  });
  if (!user) throw error(404, "User not found");
  const postsLikes = await db.query.posts.findMany({
    where(fields, { eq, and }) {
      return and(eq(fields.authorId, user.id), isNotNull(fields.parentPostId));
    },
    with: {
      author: true,
      parentPost: {
        with: {
          author: {
            columns: {
              username: true,
            },
          },
        },
      },
    },
    orderBy({ createdAt }, { desc }) {
      return desc(createdAt);
    },
  });

  const formattedPosts = [];
  for (const post of postsLikes) {
    formattedPosts.push({
      ...post,
      isLiked: await isPostAlreadyLiked(post.id, currentUser?.id),
      createdAt: formatDistanceToNowStrict(post.createdAt),
      likesCount: await fetchPostLikesCount(post.id),
      repliesCount: await fetchPostRepliesCount(post.id),
    });
  }
  return formattedPosts;
}
async function fetchProfilePosts({
  params,
  error,
  sharedMap,
}: RequestEventLoader) {
  const currentUser = sharedMap.get("user");
  const user = await db.query.users.findFirst({
    where(users, { eq }) {
      return eq(users.username, params.username);
    },
  });
  if (!user) throw error(404, "User not found");
  const posts = await db.query.posts.findMany({
    where(posts, { eq, and }) {
      return and(eq(posts.authorId, user.id), isNull(posts.parentPostId));
    },
    with: {
      author: true,
    },
    orderBy({ createdAt }, { desc }) {
      return desc(createdAt);
    },
  });

  const formattedPosts = [];
  for (const post of posts) {
    formattedPosts.push({
      ...post,
      isLiked: await isPostAlreadyLiked(post.id, currentUser?.id),
      createdAt: formatDistanceToNowStrict(post.createdAt),
      likesCount: await fetchPostLikesCount(post.id),
      repliesCount: await fetchPostRepliesCount(post.id),
    });
  }
  return formattedPosts;
}
async function handleUpdateProfileAction(
  profile: Partial<Profile>,
  { sharedMap, redirect }: RequestEventAction
) {
  const currentUser = sharedMap.get("user") as AuthUser | undefined;
  if (!currentUser) throw redirect(308, "/login");
  await updateProfile(currentUser.id, profile);
}

async function handleFetchProfileInfo({
  sharedMap,
  redirect,
}: RequestEventLoader) {
  const currentUser = sharedMap.get("user") as AuthUser | undefined;
  if (!currentUser) throw redirect(308, "/login");

  const profile = await db.query.profile.findFirst({
    where(fields, { eq }) {
      return eq(fields.userId, currentUser.id);
    },
    with: {
      user: true,
    },
  });

  return {
    ...profile,
    dob: profile?.dob && format(profile.dob, "yyyy-MM-dd"),
  };
}
export {
  createProfile,
  updateProfile,
  fetchUserProfile,
  fetchProfileFollowCount,
  fetchProfilePostsCount,
  fetchProfileLikedPosts,
  fetchProfilePosts,
  fetchProfilePostsReplies,
  handleUpdateProfileAction,
  handleFetchProfileInfo,
};
