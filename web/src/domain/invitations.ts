export async function shareInvitation(
  url: string,
): Promise<"shared" | "cancelled"> {
  if (!navigator.share)
    throw new Error("Select Copy link to share this invitation.");
  try {
    // Invoke immediately from the tap, without asynchronous work before share().
    await navigator.share({
      title: "Join our household — Did I Feed My Baby?",
      text: "You're invited to help track our baby's care. This invitation expires in 7 days.",
      url,
    });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return "cancelled";
    throw new Error(
      "Could not open sharing. Select Copy link to send the invitation.",
    );
  }
}

export async function copyInvitation(url: string) {
  if (!navigator.clipboard?.writeText)
    throw new Error("Select and copy the link above.");
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    throw new Error("Select and copy the link above.");
  }
}
