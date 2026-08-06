import { memo, type MouseEvent } from 'react';
import { AttachedFilesBar, type AttachedFileChip } from './AttachedFilesBar';
import { QuotedSelectionCard } from './QuotedSelectionCard';
import type { AttachedFile } from '../../stores/input-slice';
import styles from './InputArea.module.css';

interface Props {
  attachedFiles: AttachedFile[];
  removeAttachedFile: (index: number) => void;
  hasQuotedSelection: boolean;
  onChipClick?: (file: AttachedFileChip, event: MouseEvent<HTMLSpanElement>) => void;
}

/** 输入框上方的上下文行：附件、引用 */
export const InputContextRow = memo(function InputContextRow({
  attachedFiles, removeAttachedFile, hasQuotedSelection, onChipClick,
}: Props) {
  if (attachedFiles.length === 0 && !hasQuotedSelection) return null;

  return (
    <div className={styles['input-context-row']}>
      <div className={styles['input-context-left']}>
        {attachedFiles.length > 0 && (
          <AttachedFilesBar
            files={attachedFiles}
            onRemove={removeAttachedFile}
            onChipClick={onChipClick}
          />
        )}
        <QuotedSelectionCard />
      </div>
    </div>
  );
});
