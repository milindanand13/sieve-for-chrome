/** Grader hint from Return YouTube Dislike counts: only when a fifth or more of at least 200 votes are dislikes. */
export function dislikeHint(likes: number, dislikes: number): string {
  const votes = likes + dislikes;
  if (votes < 200) return "";
  const share = dislikes / votes;
  return share >= 0.2 ? `${Math.round(share * 100)}% of votes are dislikes` : "";
}
