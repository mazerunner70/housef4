import { Button } from '@/components/ui/Button'

type ConfirmClusterTagButtonProps = {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}

export function ConfirmClusterTagButton({
  onClick,
  disabled,
  loading,
}: ConfirmClusterTagButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="shrink-0"
    >
      {loading ? 'Saving…' : 'Confirm category'}
    </Button>
  )
}
