import { Spinner } from '@/components/ui/Spinner'

type UploadProgressIndicatorProps = {
  message: string
  detail?: string
}

export function UploadProgressIndicator({
  message,
  detail,
}: UploadProgressIndicatorProps) {
  return (
    <div
      className="glass-panel flex flex-col items-center gap-4 rounded-3xl px-6 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <Spinner className="scale-125" label={message} />
      <div>
        <p className="text-base font-medium text-zinc-100">{message}</p>
        {detail && <p className="mt-1 text-sm text-zinc-500">{detail}</p>}
      </div>
    </div>
  )
}
