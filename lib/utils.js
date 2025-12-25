export function cn(...args) {
  return args.flat().filter(Boolean).join(' ')
}

export default { cn }
