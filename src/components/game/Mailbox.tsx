"use client";

/**
 * The mailbox beside the farmer's home — the owner's sprite from
 * CozySpriteBundle/Mailbox.png (trimmed to public/sprites/misc/mailbox.png,
 * 57x108: a grey box with a red flag on a wooden post). When unread KudoSeed
 * mail is waiting, an envelope bobs above it; once the player opens the
 * Mailbox window, the envelope goes away until NEW mail arrives (read-state
 * lives in GameShell / localStorage).
 */
export function Mailbox({
  hasMail,
  onClick,
}: {
  hasMail: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={hasMail ? "Mailbox — you have new mail" : "Mailbox"}
      title={hasMail ? "You have mail!" : "Mailbox"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative flex flex-col items-center border-0 bg-transparent p-0"
    >
      {hasMail && (
        <span
          aria-hidden
          className="rf-throb absolute -top-5 left-1/2 -translate-x-1/2 text-base leading-none"
        >
          ✉️
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/sprites/misc/mailbox.png"
        alt=""
        className="pixelated"
        style={{ width: 22, height: "auto" }}
      />
    </button>
  );
}
