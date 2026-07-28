import { Link } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { isLinkrHandle, normalizeProfileHandle } from "@/lib/linkr/profile-links";

const HANDLE_PATTERN = /@([A-Za-z0-9_]{1,15})/g;

export function ProfileHandleLink({
  children,
  className,
  handle,
}: {
  children?: ReactNode;
  className?: string;
  handle: string | null | undefined;
}) {
  const username = normalizeProfileHandle(handle);
  const label = children ?? (username ? `@${username}` : handle);

  if (!username || isLinkrHandle(username)) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Link className={className} to="/u/$username" params={{ username }}>
      {label}
    </Link>
  );
}

export function ProfileLinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HANDLE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const mention = match[0];
    const username = match[1];

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    parts.push(
      <ProfileHandleLink key={`${username}-${matchIndex}`} handle={username}>
        {mention}
      </ProfileHandleLink>,
    );
    lastIndex = matchIndex + mention.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
