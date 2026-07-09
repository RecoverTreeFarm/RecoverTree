import {
  SPRITES,
  TREE_SHEET,
  TREE_BEARING_STAGE,
  treeFrameForStage,
  fruitSprite,
  FRUIT_BLUE,
} from "@/lib/sprites";

/**
 * A single crisp-scaled sprite image. `scale` multiplies the intrinsic
 * pixel size so 16x16 art stays chunky instead of blurry.
 */
export function Sprite({
  src,
  size,
  scale = 3,
  alt = "",
  className = "",
  style,
}: {
  src: string;
  /** intrinsic pixel width x height, e.g. [16, 16] */
  size: [number, number];
  scale?: number;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [w, h] = size;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={w * scale}
      height={h * scale}
      className={`pixelated ${className}`}
      style={{ width: w * scale, height: h * scale, ...style }}
    />
  );
}

/**
 * Where the 3 fruits hang on a bearing tree (16x20 sheet-pixel coords).
 */
const FRUIT_SPOTS: [number, number][] = [
  [3, 4],
  [9, 3],
  [6, 10],
];

/**
 * A "Tree" (really a bush from the sprite pack — the product calls them
 * Trees). Renders one growth stage (1..5):
 *   stage 1..4 → sheet columns 2..5 (sapling → full empty bush)
 *   stage 5    → bearing: full empty bush + 3 fruits of ONE kind hanging
 *                on it (visual only — harvest rewards are unchanged).
 * `fruitIndex` picks which fruit sprite this tree grows (stable per tree).
 */
export function Tree({
  stage = 1,
  scale = 4,
  fruitIndex = 0,
  className = "",
}: {
  stage?: number;
  scale?: number;
  fruitIndex?: number;
  className?: string;
}) {
  const { frameWidth, frameHeight, frameCount } = TREE_SHEET;
  const clamped = Math.max(1, Math.min(TREE_BEARING_STAGE, stage));
  const bearing = clamped === TREE_BEARING_STAGE;
  const frame = treeFrameForStage(clamped);
  const fruitPx = 5 * scale; // fruit render size

  return (
    <div
      role="img"
      aria-label={bearing ? "tree bearing fruit" : "tree"}
      className={`relative pixelated ${className}`}
      style={{
        width: frameWidth * scale,
        height: frameHeight * scale,
        backgroundImage: `url(${SPRITES.treeSheet})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${frameWidth * frameCount * scale}px ${frameHeight * scale}px`,
        backgroundPosition: `-${frame * frameWidth * scale}px 0`,
        imageRendering: "pixelated",
      }}
    >
      {bearing &&
        FRUIT_SPOTS.map(([x, y], i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={fruitSprite(fruitIndex)}
            alt=""
            className="pixelated absolute"
            style={{ left: x * scale, top: y * scale, width: fruitPx, height: fruitPx }}
          />
        ))}
    </div>
  );
}

/**
 * A "Fruit" icon: a small cluster of blueberry-blue pixel dots (the game
 * doc asks for 1–3 pixel dots). Used next to Fruit counts.
 */
export function Fruit({
  scale = 2,
  color = FRUIT_BLUE,
  title,
  className = "",
}: {
  scale?: number;
  color?: string;
  title?: string;
  className?: string;
}) {
  const d = 3 * scale; // one dot
  const size = d * 2.4;
  const dots: [number, number][] = [
    [0, d * 0.7],
    [d * 1.1, 0],
    [d * 0.9, d * 1.2],
  ];
  return (
    <span
      role="img"
      aria-label={title ?? "fruit"}
      title={title}
      className={`relative inline-block align-middle ${className}`}
      style={{ width: size, height: size }}
    >
      {dots.map(([x, y], i) => (
        <span
          key={i}
          className="absolute"
          style={{
            left: x,
            top: y,
            width: d,
            height: d,
            background: color,
            boxShadow: `inset ${scale}px ${scale}px 0 rgba(255,255,255,0.35)`,
          }}
        />
      ))}
    </span>
  );
}
