import {
  SPRITES,
  TREE_SHEET,
  TREE_BEARING_STAGE,
  TREE_STAGE_SIZE,
  treeFrameForStage,
  fruitSprite,
  orchardFruitSprite,
  DEFAULT_FRUIT_INDEX,
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
  // Each growth phase renders visibly bigger than the last (visual only —
  // growth logic lives server-side). Bottom-aligned by the grid, so trees
  // grow "up" out of the soil.
  const effScale = scale * (TREE_STAGE_SIZE[clamped] ?? 1);
  const fruitPx = 6 * effScale; // fruit render size
  const pink = bearing && isBlossom;

  return (
    <div
      role="img"
      aria-label={
        pink
          ? "cherry blossom tree bearing cherries"
          : bearing
            ? "tree bearing fruit"
            : "tree"
      }
      className={`relative pixelated ${className}`}
      style={{
        width: frameWidth * effScale,
        height: frameHeight * effScale,
        backgroundImage: `url(${pink ? SPRITES.treeBlossom : SPRITES.treeSheet})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: pink
          ? `${frameWidth * effScale}px ${frameHeight * effScale}px`
          : `${frameWidth * frameCount * effScale}px ${frameHeight * effScale}px`,
        backgroundPosition: pink ? "0 0" : `-${frame * frameWidth * effScale}px 0`,
        imageRendering: "pixelated",
      }}
    >
      {/* An ordinary bearing tree gets fruit dots from the cherry-FREE pool.
          The cherry-blossom sprite already has its cherries painted on, so it
          gets no overlay — cherries can only ever come from that tree. */}
      {bearing &&
        !isBlossom &&
        FRUIT_SPOTS.map(([x, y], i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={orchardFruitSprite(fruitIndex)}
            alt=""
            className="pixelated absolute"
            style={{ left: x * effScale, top: y * effScale, width: fruitPx, height: fruitPx }}
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
  orchard = false,
}: {
  scale?: number;
  index?: number;
  title?: string;
  className?: string;
  /** pick from the cherry-free pool (fruit growing on an ordinary tree) */
  orchard?: boolean;
}) {
  const size = Math.round(9 * scale);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={orchard ? orchardFruitSprite(index) : fruitSprite(index)}
      alt={title ?? "fruit"}
      title={title}
      width={size}
      height={size}
      className={`pixelated inline-block align-middle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** The cherry — reserved for the cherry-blossom tree (and the Fruit currency). */
export function CherryFruit({ scale = 2, className = "" }: { scale?: number; className?: string }) {
  return <Fruit scale={scale} index={DEFAULT_FRUIT_INDEX} className={className} />;
}
