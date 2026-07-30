"use client";

import { useState } from "react";
import {
  clearMessageFeedback,
  submitMessageFeedback,
  type FeedbackRating,
} from "@/lib/api";

// Thumbs up/down on one AI answer. Optimistic toggle; a thumbs-down offers
// an optional one-line comment that feeds the assistant's memory.
export default function FeedbackButtons({
  chatId,
  initial = null,
}: {
  chatId: number;
  initial?: FeedbackRating | null;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(initial);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);

  const toggle = async (value: FeedbackRating) => {
    const next = rating === value ? null : value;
    setRating(next);
    setShowComment(next === "down");
    setCommentSent(false);

    try {
      if (next === null) {
        await clearMessageFeedback(chatId);
      } else {
        await submitMessageFeedback(chatId, next);
      }
    } catch (error) {
      console.error("Failed to save feedback:", error);
      setRating(rating);
    }
  };

  const sendComment = async () => {
    if (!comment.trim() || rating !== "down") return;
    try {
      await submitMessageFeedback(chatId, "down", comment.trim());
      setCommentSent(true);
      setShowComment(false);
    } catch (error) {
      console.error("Failed to save feedback comment:", error);
    }
  };

  const buttonStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 8px",
    borderRadius: 999,
    border: active
      ? "1px solid rgba(201,169,110,0.5)"
      : "1px solid rgba(201,169,110,0.15)",
    background: active ? "rgba(201,169,110,0.15)" : "transparent",
    color: active ? "#c9a96e" : "#5a4f3f",
    fontSize: 11,
    cursor: "pointer",
    lineHeight: 1.6,
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => toggle("up")}
          title="Good answer"
          style={buttonStyle(rating === "up")}
        >
          👍
        </button>
        <button
          type="button"
          onClick={() => toggle("down")}
          title="Bad answer"
          style={buttonStyle(rating === "down")}
        >
          👎
        </button>
        {commentSent && (
          <span style={{ fontSize: 10, color: "#5a4f3f" }}>
            Thanks - I&apos;ll remember that.
          </span>
        )}
      </div>
      {showComment && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendComment();
              }
            }}
            placeholder="What was wrong? (optional - helps me improve)"
            style={{
              flex: 1,
              padding: "4px 8px",
              borderRadius: 8,
              border: "1px solid rgba(201,169,110,0.15)",
              background: "rgba(20,16,10,0.6)",
              color: "#cfc0a4",
              fontSize: 11,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={sendComment}
            style={buttonStyle(false)}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
