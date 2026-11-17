import React from 'react'
import {Notice} from './components.jsx'

export function SelectionDetailsNotice({available}) {
  return available ? null : <Notice tone="info">This workspace saves the entered text without a separate category label. Existing recorded values stay unchanged.</Notice>
}
