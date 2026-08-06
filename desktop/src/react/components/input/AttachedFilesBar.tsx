import { memo, type MouseEvent } from 'react';
import { AttachmentChip } from '../shared/AttachmentChip';
import { AudioAttachmentChip } from '../shared/AudioAttachmentChip';
import { FolderIcon } from '../shared/FolderIcon';
import { kindOfFileName } from '../../utils/file-kind';
import styles from './InputArea.module.css';

export interface AttachedFileChip {
  path: string;
  name: string;
  isDirectory?: boolean;
  base64Data?: string;
  mimeType?: string;
}

export const AttachedFilesBar = memo(function AttachedFilesBar({
  files,
  onRemove,
  onChipClick,
}: {
  files: AttachedFileChip[];
  onRemove: (index: number) => void;
  /** chip 本体点击：上层据此打开预览/打开文件。不传则 chip 不可点。 */
  onChipClick?: (file: AttachedFileChip, event: MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <div className={styles['attached-files']}>
      {files.map((f, i) => {
        const kind = f.isDirectory ? 'directory' : kindOfFileName(f.name || f.path, f.mimeType);
        if (kind === 'audio') {
          return (
            <AudioAttachmentChip
              key={f.path}
              file={f}
              onRemove={() => onRemove(i)}
            />
          );
        }
        if (kind === 'image' || kind === 'svg') {
          return (
            <ImageAttachmentChip
              key={f.path}
              file={f}
              onRemove={() => onRemove(i)}
              onClick={onChipClick ? (event) => onChipClick(f, event) : undefined}
            />
          );
        }
        return (
          <AttachmentChip
            key={f.path}
            icon={f.isDirectory ? <FolderIcon /> : <ClipIcon />}
            name={f.name}
            onRemove={() => onRemove(i)}
            onClick={onChipClick ? (event) => onChipClick(f, event) : undefined}
          />
        );
      })}
    </div>
  );
});

function ImageAttachmentChip({
  file,
  onRemove,
  onClick,
}: {
  file: AttachedFileChip;
  onRemove: () => void;
  onClick?: (event: MouseEvent<HTMLSpanElement>) => void;
}) {
  const src = getMediaUrl(file);
  const interactive = Boolean(onClick);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(event as unknown as MouseEvent<HTMLSpanElement>);
    }
  };
  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>) => {
    // 阻止点 X 触发 chip 本体点击
    event.stopPropagation();
    onRemove();
  };
  return (
    <span
      className={`${styles['media-attachment-chip']}${interactive ? ` ${styles['media-attachment-chip-interactive']}` : ''}`}
      title={interactive ? `${file.name}（点击预览）` : file.name}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${file.name}（点击预览）` : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      <span className={styles['image-attachment-preview']} aria-hidden="true">
        {src ? (
          <img src={src} alt="" />
        ) : (
          <ClipIcon />
        )}
      </span>
      <span className={styles['media-attachment-name']}>{file.name}</span>
      <RemoveButton name={file.name} onRemove={handleRemoveClick} />
    </span>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      className={styles['media-attachment-remove']}
      onClick={onRemove}
      aria-label={`Remove ${name}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

function getMediaUrl(file: { path: string; base64Data?: string; mimeType?: string }) {
  if (file.base64Data && file.mimeType) {
    return `data:${file.mimeType};base64,${file.base64Data}`;
  }
  if (typeof window === 'undefined') return null;
  return window.platform?.getFileUrl?.(file.path) || null;
}

function ClipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
