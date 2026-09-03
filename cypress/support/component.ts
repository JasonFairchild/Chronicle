import { mount } from 'cypress/vue'
import '@/assets/main.css'

Cypress.Commands.add('mount', mount)

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mount: typeof mount
    }
  }
}
