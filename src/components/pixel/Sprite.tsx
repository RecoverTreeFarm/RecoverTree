import {
  SPRITES,
  TREE_SHEET,
  TREE_BEARING_STAGE,
  treeFrameForStage,
  fruitSprite,
  DEFAULT_FRUIT_INDEX,
  CHERRY_FRUIT_INDEX,
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
 * Where the 3 fruits hang on a bearing tree (32x44 canopy sheet-pixel coords).
 */
const FRUIT_SPOTS: [number, number][] = [
  [8, 14],
  [19, 11],
  [13, 21],
];

/**
 * A cozy fruit "Tree". Renders one growth stage (1..5):
 *   stage 1..4 → growth strip frames 1..4 (sprout → full tree)
 *   stage 5    → bearing: full tree + 3 fruits of ONE kind hanging on it.
 *                A blossom tree (isBlossom) shows the pink variant instead and
 *                pays out 2x on harvest (handled server-side).
 * `fruitIndex` picks which fruit sprite this tree grows (stable per tree).
 */
export function Tree({
  stage = 1,
  scale = 2,
  fruitIndex = 0,
  isBlossom = false,
  className = "",
}: {
  stage?: number;
  scale?: number;
  fruitIndex?: number;
  isBlossom?: boolean;
  className?: string;
}) {
  const { frameWidth, frameHeight, frameCount } = TREE_SHEET;
  const clamped = Math.max(1, Math.min(TREE_BEARING_STAGE, stage));
  const bearing = clamped === TREE_BEARING_STAGE;
  const frame = treeFrameForStage(clamped);
  const fruitPx = 6 * scale; // fruit render size
  const pink = bearing && isBlossom;
  // Pink blossom trees ALWAYS grow cherries; normal trees keep their
  // per-slot fruit.
  const effectiveFruit = isBlossom ? CHERRY_FRUIT_INDEX : fruitIndex;

  return (
    <div
      role="img"
      aria-label={pink ? "blossom tree bearing fruit" : bearing ? "tree bearing fruit" : "tree"}
      className={`relative pixelated ${className}`}
      style={{
        width: frameWidth * scale,
        height: frameHeight * scale,
        backgroundImage: `url(${pink ? SPRITES.treeBlossom : SPRITES.treeSheet})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: pink
          ? `${frameWidth * scale}px ${frameHeight * scale}px`
          : `${frameWidth * frameCount * scale}px ${frameHeight * scale}px`,
        backgroundPosition: pink ? "0 0" : `-${frame * frameWidth * scale}px 0`,
        imageRendering: "pixelated",
      }}
    >
      {bearing &&
        FRUIT_SPOTS.map(([x, y], i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={fruitSprite(effectiveFruit)}
            alt=""
            className="pixelated absolute"
            style={{ left: x * scale, top: y * scale, width: fruitPx, height: fruitPx }}
          />
        ))}
    </div>
  );
}

/**
 * A "Fruit" icon — a real little fruit sprite from the food-icon sheet (used
 * next to Fruit counts). `index` picks which fruit from the curated pool;
 * omitted, it shows the default (cherries). Replaces the old pixel dots.
 */
export function Fruit({
  scale = 2,
  index = DEFAULT_FRUIT_INDEX,
  title,
  className = "",
}: {
  scale?: number;
  index?: number;
  title?: string;
  className?: string;
}) {
  const size = Math.round(9 * scale);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fruitSprite(index)}
      alt={title ?? "fruit"}
      title={title}
      width={size}
      height={size}
      className={`pixelated inline-block align-middle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
