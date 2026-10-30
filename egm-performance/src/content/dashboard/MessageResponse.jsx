import React, {memo} from 'react'
import {Streamdown} from 'streamdown'
import './message-response.css'

const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion:reduce)').matches
const fade={animation:'fadeIn',sep:'word',duration:180}

// AI Elements' MessageResponse pattern, styled for this dashboard.
export const MessageResponse = memo(function MessageResponse({children, isAnimating, components}) {
  return <Streamdown className="egm-message-response" isAnimating={isAnimating} animated={reduced()?false:fade} controls={false} components={components}>{children}</Streamdown>
})
