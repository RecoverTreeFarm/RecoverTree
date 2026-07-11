"use client";

/**
 * A little mailbox beside the farmer's home. When a KudoSeed has arrived, an
 * envelope bobs above it and the flag stands up. Tap to open the Mailbox
 * window (received mail + send a KudoSeed). Drawn in CSS to match the store
 * interior style — there's no mailbox sprite in the asset packs yet.
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
      <span className="relative block" style={{ width: 24, height: 30 }}>
        {/* post */}
        <span
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{ width: 5, height: 16, background: "var(--rf-wood)", border: "1px solid var(--rf-ink)" }}
        />
        {/* box body */}
        <span
          className="absolute left-0 top-0 rounded-t-lg"
          style={{
            width: 24,
            height: 16,
            background: hasMail ? "var(--rf-red)" : "var(--rf-blue)",
            border: "2px solid var(--rf-ink)",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.25)",
          }}
        />
        {/* raised flag when there's mail */}
        <span
          className="absolute"
          style={{
            right: -3,
            top: hasMail ? -1 : 8,
            width: 5,
            height: 6,
            background: "var(--rf-gold)",
            border: "1px solid var(--rf-ink)",
            transition: "top 0.3s ease",
          }}
        />
      </span>
    </button>
  );
}
