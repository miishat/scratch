import { Dialog } from '../components/Dialog'
import { useVault } from '../features/vault/VaultProvider'

type Props = { onClose: () => void, onChangePassphrase: () => void }

export function SettingsDialog({ onClose, onChangePassphrase }: Props) {
  const { requestLock } = useVault()
  function lockNow() {
    onClose()
    requestLock()
  }
  return <Dialog title="Settings" onRequestClose={onClose} canClose={() => true}>
    <section aria-labelledby="settings-security">
      <h3 id="settings-security">Security</h3>
      <p>Locking applies to this tab only. Other tabs stay unlocked until they lock.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={lockNow}>Lock now</button>
        <button type="button" onClick={onChangePassphrase}>Change passphrase</button>
      </div>
    </section>
  </Dialog>
}
