/**
 * In-game guidebook content. Plain data (no JSX) so chapters are easy to edit
 * without touching the WikiPanel component. Keep sections short and warm —
 * this reads like a cozy game manual, not documentation.
 *
 * THE ECONOMY RULE appears in several chapters on purpose: Water, Seeds, and
 * Fertilizer are the rewards; Fruits are NEVER awarded directly — they only
 * come from harvesting trees, and harvested Fruits are the leaderboard score.
 */

/** Future bug reports will be emailed here (not wired up yet). */
export const BUG_REPORT_EMAIL = "dominictallariti@gmail.com";

export type WikiSection = {
  heading?: string;
  /** short paragraphs */
  body?: string[];
  /** compact bullet list */
  bullets?: string[];
};

export type WikiChapter = {
  id: string;
  title: string;
  /** tiny emoji shown on the chapter tab */
  icon: string;
  sections: WikiSection[];
};

export const WIKI_CHAPTERS: WikiChapter[] = [
  {
    id: "quick-start",
    title: "Quick Start",
    icon: "🌱",
    sections: [
      {
        body: [
          "Welcome, farmer! Here's the whole game in one minute.",
          "This app doesn't host meetings or chat. Meetings happen on tools like Google Meet, and chat happens on Signal or WhatsApp. RecoverTree is the cozy farm that celebrates you showing up.",
        ],
      },
      {
        heading: "The loop",
        bullets: [
          "Attend a meeting and enter the meeting code.",
          "Earn Water, Seeds, and Fertilizer.",
          "Use them to grow trees on your farm.",
          "Trees produce Fruits — harvest them!",
          "Harvested Fruits are your leaderboard score.",
        ],
      },
      {
        heading: "Along the way",
        bullets: [
          "Give a Seed to support a fellow farmer.",
          "Watch for community events: the Traveling Basket and the Golden Goose.",
          "At season's end, the ceremony reveals medals and badges.",
        ],
      },
    ],
  },
  {
    id: "your-farm",
    title: "Your Farm",
    icon: "🏡",
    sections: [
      {
        body: ["Your farm is the main screen — everything grows here."],
      },
      {
        heading: "Tending it",
        bullets: [
          "Plant Seeds to grow new trees.",
          "Water helps trees grow through their stages.",
          "A fully watered tree ripens on its own; Fertilizer ripens a waiting tree right away.",
          "When a tree is ready, harvest it for Fruits.",
        ],
      },
      {
        heading: "Make it yours",
        body: [
          "Pick your farmer and your farmhouse from your Profile. Cosmetics are just for coziness — they don't change rewards.",
          "Remember: actions never hand you Fruits directly. Fruits always come from harvesting your trees.",
        ],
      },
    ],
  },
  {
    id: "water-seeds-fertilizer",
    title: "Water, Seeds & Fertilizer",
    icon: "💧",
    sections: [
      {
        body: [
          "These three items are the only direct rewards in the game.",
        ],
      },
      {
        heading: "What they do",
        bullets: [
          "💧 Water — common. Helps your trees grow a stage at a time.",
          "🌰 Seeds — plant them to expand your farm with new trees.",
          "✨ Fertilizer — more special. Instantly ripens a tree that's waiting on its fruit timer.",
        ],
      },
      {
        heading: "How you earn them",
        body: [
          "Meetings, giving and receiving Seeds, checklist goals, the Traveling Basket, the Golden Goose — every participation reward pays out in these three items.",
          "They help your farm flourish, but they aren't points by themselves. Only harvested Fruits count on the leaderboard.",
        ],
      },
    ],
  },
  {
    id: "fruits-leaderboard",
    title: "Fruits & Leaderboard",
    icon: "🍒",
    sections: [
      {
        body: [
          "Fruits are the score — and they come from one place only: harvesting your trees.",
        ],
      },
      {
        bullets: [
          "The leaderboard ranks farmers by harvested Fruits.",
          "It resets each season, so every season is a fresh start.",
          "Rewards (Water, Seeds, Fertilizer) help your trees grow, but only the harvest counts.",
          "Rare pink blossom trees pay double Fruits when harvested.",
        ],
      },
      {
        body: [
          "Privacy Mode changes how you appear publicly — see the Privacy Mode chapter.",
        ],
      },
    ],
  },
  {
    id: "meeting-codes",
    title: "Meeting Codes",
    icon: "🔢",
    sections: [
      {
        body: [
          "Meeting codes connect real-world showing up to your farm.",
        ],
      },
      {
        bullets: [
          "A Meeting Host generates a 4-digit code in the app.",
          "The code is read aloud during the meeting (the meeting itself happens outside the app, like on Google Meet).",
          "Enter the code in the app to collect your reward.",
          "Codes expire after a while, and each code can only be claimed once per farmer.",
        ],
      },
    ],
  },
  {
    id: "daily-seeds",
    title: "Daily Seeds",
    icon: "🌰",
    sections: [
      {
        body: [
          "Once a day, you can give a Seed to another farmer — a small, quiet way of saying \"I see you.\"",
        ],
      },
      {
        bullets: [
          "The receiver gets a plantable Seed for their farm.",
          "The giver gets a little Water for their kindness.",
          "You can't give a Seed to yourself.",
          "When you have Seeds ready, the farm shows a Plant Seed prompt.",
        ],
      },
      {
        body: [
          "Seeds aren't likes. There's no streak to keep and no score to chase — just support.",
        ],
      },
    ],
  },
  {
    id: "checklist",
    title: "Seasonal Checklist",
    icon: "📋",
    sections: [
      {
        body: [
          "Each season brings a small set of shared goals — gentle nudges to stay involved.",
        ],
      },
      {
        bullets: [
          "Goals reward Water and Fertilizer when completed.",
          "A notification lets you know when you've reached one.",
          "Progress lives in the Goals window on the bottom menu.",
          "Checklist rewards never include Fruits — those still come from your harvest.",
        ],
      },
    ],
  },
  {
    id: "traveling-basket",
    title: "Traveling Basket",
    icon: "🧺",
    sections: [
      {
        body: [
          "Some days, a community basket starts traveling from farm to farm.",
        ],
      },
      {
        heading: "How it works",
        bullets: [
          "When it reaches you, add a little Water, a Seed, or Fertilizer.",
          "Then choose: pass it on, or keep it.",
          "Keep it, and you receive double what's inside — but the journey ends.",
          "If it reaches its target number of farmers, everyone who touched it receives the full contents.",
        ],
      },
      {
        body: [
          "Most baskets lock in at 5 farmers; rarely, a big basket wants 10. Basket rewards are always Water, Seeds, and Fertilizer — never Fruits.",
        ],
      },
    ],
  },
  {
    id: "golden-goose",
    title: "Golden Goose",
    icon: "🪿",
    sections: [
      {
        body: [
          "Now and then, the Golden Goose visits one farmer — the Keeper.",
        ],
      },
      {
        heading: "How it works",
        bullets: [
          "The goose appears on the Keeper's farm.",
          "The Keeper asks a supportive question in the community chat — the app never shows the question.",
          "Everyone reads it in the chat, then submits an answer in the app.",
          "Answers are anonymous while the Keeper chooses a favorite.",
          "The chosen farmer receives the Golden Goose Egg — a bundle of Water, a Seed, and Fertilizer.",
        ],
      },
      {
        body: [
          "If the Keeper's time runs out, the goose may gently pick a winner on its own from the answers it has. No Fruits are ever in the egg — the harvest is still yours to grow.",
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy Mode",
    icon: "🕊️",
    sections: [
      {
        body: [
          "You choose how you appear to the community, and the app respects that choice everywhere.",
        ],
      },
      {
        bullets: [
          "Public — you appear by name on leaderboards and profiles.",
          "Anonymous — you can appear in shared spaces without revealing your name.",
          "Hidden — you're left out of public and social features.",
        ],
      },
      {
        body: [
          "Your mode can affect leaderboards, profiles, and eligibility for social events like the Traveling Basket and Golden Goose. Change it anytime in Settings.",
        ],
      },
    ],
  },
  {
    id: "ceremony",
    title: "Medals, Badges & Ceremony",
    icon: "🏅",
    sections: [
      {
        body: [
          "When a season ends, the community gathers (in spirit) for the ceremony.",
        ],
      },
      {
        bullets: [
          "The top harvesters receive gold, silver, and bronze medals.",
          "A few badges celebrate different kinds of showing up — not just the biggest harvest.",
          "Ceremony rewards are Fertilizer for the new season.",
          "And yes — Fruits still only ever come from harvested trees.",
        ],
      },
      {
        body: [
          "Badges are meant to be fun and kind. Every season is a new chance.",
        ],
      },
    ],
  },
  {
    id: "roles",
    title: "Admins & Meeting Hosts",
    icon: "🧑‍🌾",
    sections: [
      {
        body: [
          "A few community members carry extra keys.",
        ],
      },
      {
        bullets: [
          "Meeting Hosts can start meetings and generate the 4-digit codes.",
          "Admins can manage roles, handle problems, and tune game settings like reward amounts and event schedules.",
        ],
      },
      {
        body: [
          "Admin changes affect the whole community, so they're made carefully — and every admin action is recorded.",
        ],
      },
    ],
  },
  {
    id: "report-bug",
    title: "Report a Bug",
    icon: "🐛",
    sections: [
      {
        body: [
          "Found something weird? This will eventually send a bug report to the app admin.",
        ],
      },
    ],
  },
];
