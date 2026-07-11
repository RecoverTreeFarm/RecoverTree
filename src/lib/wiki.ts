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
  /** real game sprites shown as a labelled strip */
  sprites?: { src: string; label: string; height?: number }[];
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
          "After the tutorial, explore the Map — the Community Garden, the General Store, and the Weekly Orchard Lottery are all out there to discover.",
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
        sprites: [
          { src: "/sprites/icons/seed_packet.png", label: "seeds", height: 32 },
          { src: "/sprites/plants/tree_green.png", label: "growth stages", height: 44 },
          { src: "/sprites/fruit/fruit_13.png", label: "fruit", height: 24 },
        ],
      },
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
          "🧴 Fertilizer — more special. Instantly ripens a tree that's waiting on its fruit timer.",
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
        ],
      },
      {
        heading: "Rare Cherry Blossom trees",
        body: [
          "Every now and then, a tree turns into a Cherry Blossom while it grows — you'll see it bloom pink. Cherry Blossoms are rare, so it's a treat when one appears.",
          "A Cherry Blossom produces Cherries, and Cherries are still Fruits. They give x2 Cherries — double the usual harvest. Like every Fruit, they count only when you harvest the tree; nothing hands you Cherries as a reward.",
        ],
        sprites: [{ src: "/sprites/plants/tree_cherry.png", label: "cherry blossom", height: 52 }],
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
    title: "Daily KudoSeeds",
    icon: "🌰",
    sections: [
      {
        heading: "Say something, too",
        body: [
          "A KudoSeed carries a note if you want it to. Thank someone, tell them what you noticed, celebrate a milestone they hit. Tap a starter phrase or write your own — they'll see it with the seed.",
          "You still earn 💧 10 water for sending one, and they get a seed to plant. Kindness is the only currency that grows both ways.",
        ],
      },
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
          "Some seasons include optional Weekly Orchard Lottery goals — like buying a first ticket. Winning is never a goal; entering is enough.",
          "Checklist rewards never include Fruits — those still come from your harvest.",
        ],
      },
    ],
  },
  {
    id: "weekly-lottery",
    title: "Weekly Orchard Lottery",
    icon: "🎟️",
    sections: [
      {
        body: [
          "Once a week, the valley holds a small community drawing. It's a light, cozy thing — no real money is ever involved, and no Fruits either. Tickets and prizes are Coins only; Fruits still come only from harvesting your trees.",
        ],
      },
      {
        heading: "How a week works",
        bullets: [
          "A new drawing opens each week. Find it on the shelf at the General Store.",
          "Buy up to 3 tickets with 🪙 Coins. Each ticket is one entry.",
          "Every ticket adds its Coin price to the community-funded pot.",
          "On Sunday, the Orchard adds a bonus — 25% of the community pot.",
          "If at least two different farmers entered, one ticket is drawn, and the winner receives the community pot plus the Orchard bonus.",
        ],
      },
      {
        heading: "Quiet weeks",
        bullets: [
          "If only one farmer entered, they get a full Coin refund — no Orchard bonus, no drawing. No harm done.",
          "If nobody enters, the round simply closes without a winner.",
          "The result is announced in the app, and privacy settings decide how the winner appears.",
        ],
      },
      {
        body: [
          "Admins can adjust the ticket price, ticket limit, schedule, and Orchard bonus. Enter when it sounds fun — there's no streak, no pressure, and skipping a week costs nothing.",
        ],
      },
    ],
  },
  {
    id: "world-map",
    title: "The World Map",
    icon: "🗺️",
    sections: [
      {
        body: [
          "Tap Map on the bottom menu to see the valley. Your farm isn't the only place you can be.",
          "Pick a destination and your farmer walks there — trees and flowers drift past, butterflies tag along, and a little tune plays for the trip. When you arrive the music changes to match the place.",
        ],
      },
      {
        heading: "Where you can go",
        bullets: [
          "🌳 Community Garden — the shared tree everyone tends.",
          "🏪 General Store — spend Coins on supplies.",
          "🏡 Your RecoverTree Farm — home, always one tap away.",
          "🛋️ Furniture Store and 🎣 Fishing Supply Store — boarded up for now. Something to look forward to.",
        ],
      },
      {
        heading: "You're not alone out there",
        body: [
          "Anywhere you travel, farmers who are there right now appear too — wandering between spots, stopping to look around. Tap one to walk over and say hello. A heart pops up over you both and you earn 💧 10 water for reaching out. Once per neighbor per day.",
          "Farmers who go quiet for five minutes head home on their own.",
        ],
      },
    ],
  },
  {
    id: "community-garden",
    title: "Community Garden",
    icon: "🌳",
    sections: [
      {
        body: [
          "Every week the whole community tends one giant tree together. Nobody competes; nobody wins. It either blooms or it doesn't, and either way the care counted.",
        ],
      },
      {
        heading: "How it works",
        bullets: [
          "The garden opens Monday and rests Sunday night.",
          "Tap the donation box — your farmer walks over and the crate opens up close.",
          "Add 💧 water, 🌰 seeds, or 🧴 fertilizer. There's a daily limit per person, but you can come back tomorrow.",
          "The tree grows as the group's supplies add up. Flowers spread across the grass. At 100% it blooms pink.",
        ],
      },
      {
        heading: "The Garden Share Bundle",
        body: [
          "If all three goals are met before Sunday, every farmer who added anything receives a bundle: 💧 25 water, 🌰 2 seeds, 🧴 1 fertilizer, and 🪙 15 coins.",
          "If it doesn't quite bloom, that's alright. The garden didn't fail — it just needed more hands. As always, no Fruits: those only come from harvesting your own trees.",
        ],
        sprites: [
          { src: "/sprites/plants/tree_community.png", label: "growing", height: 44 },
          { src: "/sprites/plants/tree_cherry.png", label: "bloomed", height: 52 },
        ],
      },
    ],
  },
  {
    id: "general-store",
    title: "General Store",
    icon: "🏪",
    sections: [
      {
        body: [
          "A warm room with a wooden counter, a till, and a shopkeeper who's always glad to see you. Walk around, browse, take your time.",
          "Tap the register or the shopkeeper to open the shelves. Everything here costs 🪙 Coins — never Fruits.",
        ],
      },
      {
        heading: "On the shelves",
        bullets: [
          "💧 Water — the cheapest thing here, sold in bundles of 25.",
          "🧴 Fertilizer — ripens a waiting tree.",
          "🌰 Seeds — plant another tree on your farm.",
          "🎟️ Xtra Goose Entry — one extra Golden Goose answer, only while the goose is collecting.",
          "🎫 Lottery Ticket — out of stock. Maybe one day.",
        ],
      },
      {
        heading: "Today's Sale",
        body: [
          "One item goes on sale each day, somewhere between 10% and 40% off. Deep discounts are rare. The sale holds all day, so there's no need to refresh and hope.",
        ],
      },
    ],
  },
  {
    id: "coins",
    title: "Coins",
    icon: "🪙",
    sections: [
      {
        body: [
          "Coins are the spending money of the valley. They buy supplies at the General Store and tickets for the Weekly Orchard Lottery, and one day they'll buy cosmetics and furniture too.",
          "Coins are not score. The leaderboard only ever counts Fruits you harvested. Spend them freely.",
        ],
      },
      {
        heading: "Where Coins come from",
        bullets: [
          "A few coins ride along with every reward you earn.",
          "Rewards with seeds or fertilizer carry a slightly bigger coin bonus.",
          "Finishing a monthly goal pays coins on top of water and fertilizer.",
          "The Garden Share Bundle includes coins.",
          "Season-end medals pay the most: 🥇 100, 🥈 60, 🥉 35.",
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
          "Badges cover the whole valley: harvesting, kindness, the garden, the basket, the goose — and lottery moments like Lucky Farmer or Ticket Tiller.",
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
