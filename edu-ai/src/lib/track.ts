import { getFirebaseDb } from "./firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import type { User } from "firebase/auth";

export type EventType = "deck_generated" | "pdf_exported" | "activity_generated";

export async function trackEvent(
  user: User,
  type: EventType,
  data: Record<string, unknown>
) {
  try {
    const db = getFirebaseDb();
    if (!db) return;
    await addDoc(collection(db, "users", user.uid, "events"), {
      type,
      userEmail: user.email,
      ...data,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Tracking failed:", e);
  }
}
