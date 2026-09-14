export const format = (value: number) => (value < 0.1 ? '<0.1' : value.toFixed(1))
export const number = (value: number) => value.toLocaleString('en-US')
