import React, {memo} from 'react'
import {Streamdown} from 'streamdown'
import './message-response.css'

// AI Elements' MessageResponse pattern, styled for this dashboard.
export const MessageResponse = memo(function MessageResponse({children, isAnimating, components}) {
  return <Streamdown className="egm-message-response" isAnimating={isAnimating} controls={false} components={components}>{children}</Streamdown>
})
