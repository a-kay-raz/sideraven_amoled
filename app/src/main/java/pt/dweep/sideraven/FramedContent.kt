/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package pt.dweep.sideraven

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.view.View

/**
 * Framed content (the design thesis in the spec): the Sidebar and its frame share one surface and
 * the Fenix screen sits inside it as an inset, softly rounded panel.
 *
 * Margins the content container gets inside the frame.
 */
data class FrameInsets(
    val start: Int,
    val top: Int,
    val end: Int,
    val bottom: Int,
)

/**
 * Content insets for a docked Sidebar of [dockedWidthPx] on [side]. When [framed] is false (no
 * Sidebar on this screen or window) the content is edge to edge, as in plain Fenix.
 */
fun frameInsets(
    dockedWidthPx: Int,
    gutterPx: Int,
    verticalGutterPx: Int,
    framed: Boolean,
    side: SidebarSide = SidebarSide.Left,
): FrameInsets {
    val left =
        if (!framed) {
            FrameInsets(dockedWidthPx, 0, 0, 0)
        } else {
            FrameInsets(start = dockedWidthPx + gutterPx, top = verticalGutterPx, end = gutterPx, bottom = verticalGutterPx)
        }
    return if (side == SidebarSide.Right) left.copy(start = left.end, end = left.start) else left
}

/**
 * Paints the frame colour over the four corners of the content panel, making it look rounded.
 *
 * GeckoView renders into a surface that can't be cheaply clipped, so instead of clipping, this
 * view sits above the content and draws only the corner slivers (rect minus rounded rect).
 * It never takes touches.
 */
class CornerMaskView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val path = Path()
    private val rect = RectF()

    /** Corner radius in px. */
    var radius: Float = 0f
        set(value) {
            field = value
            invalidate()
        }

    /** The frame colour (ARGB): the top of the frame's gradient. */
    var frameColor: Int = 0
        private set
    private var frameBottom: Int = 0

    /** The frame's colours, top to bottom (the same for a plain frame). */
    fun setFrameColors(
        top: Int,
        bottom: Int,
    ) {
        frameColor = top
        frameBottom = bottom
        updateShader()
        invalidate()
    }

    private fun updateShader() {
        paint.color = frameColor
        paint.shader =
            if (frameColor == frameBottom || height == 0) {
                null
            } else {
                LinearGradient(0f, 0f, 0f, height.toFloat(), frameColor, frameBottom, Shader.TileMode.CLAMP)
            }
    }

    override fun onSizeChanged(
        w: Int,
        h: Int,
        oldw: Int,
        oldh: Int,
    ) {
        super.onSizeChanged(w, h, oldw, oldh)
        updateShader()
    }

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        setWillNotDraw(false)
    }

    override fun onDraw(canvas: Canvas) {
        if (radius <= 0f || width == 0 || height == 0) return
        rect.set(0f, 0f, width.toFloat(), height.toFloat())
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(rect, Path.Direction.CW)
        path.addRoundRect(rect, radius, radius, Path.Direction.CW)
        canvas.drawPath(path, paint)
    }
}
