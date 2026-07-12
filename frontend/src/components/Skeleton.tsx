interface SkeletonProps {
  variant?: 'block' | 'line' | 'circle'
  width?: number | string
  height?: number | string
  className?: string
}

export function Skeleton({ variant = 'block', width, height, className }: SkeletonProps) {
  return (
    <span
      className={`skeleton skeleton--${variant}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
    />
  )
}
