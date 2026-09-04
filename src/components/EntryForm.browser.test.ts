import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import EntryForm from '@/components/EntryForm.vue'

describe('EntryForm (browser)', () => {
  it('emits submit with trimmed content', async () => {
    const submitted: string[] = []
    const screen = render(EntryForm, {
      props: {
        onSubmit: (content: string) => {
          submitted.push(content)
        },
      },
    })

    const textarea = screen.getByPlaceholder('Write something worth remembering...')
    await textarea.fill('  Hello from browser test  ')

    await screen.getByRole('button', { name: 'Save entry' }).click()

    expect(submitted).toEqual(['Hello from browser test'])
  })
})
