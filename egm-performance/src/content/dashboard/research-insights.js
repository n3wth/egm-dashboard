const proposals={
  workflow:'Test one workflow example with new users; track their first successful result.',
  demo:'Test a short demo; track the first successful workflow afterward.',
  install:'Run a first-install test with new users; record completion.',
  friction:'Test the quoted workflow step; record where users stop.'
}

export const researchProposal=theme=>proposals[theme]??'Validate this observation with users before changing the product.'
