# How to Release CBook Pro

Since you cannot push the `.vsix` file directly to the source code (it's a binary installer), you should use **GitHub Releases**. This allows users to easily download the extension.

## Step-by-Step Guide

1.  **Locate the File**:
    The extension file is located on your computer at:
    `cbook/cbook-pro-0.0.1.vsix`

2.  **Go to GitHub Releases**:
    Click here: [Draft a new release](https://github.com/Cyber-Shark-02/cbook-pro/releases/new)

3.  **Fill in the Details**:
    *   **Choose a tag**: Type `v0.0.1` and click "Create new tag".
    *   **Release title**: `CBook Pro v0.0.1 - Initial Release`.
    *   **Describe this release**: You can paste the contents of your README or just say "First release with Python, C, C++, and Java support!".

4.  **Upload the Extension**:
    *   Look for the box that says **"Attach binaries by dropping them here or selecting them."**
    *   Drag and drop the `cbook-pro-0.0.1.vsix` file into that box.

5.  **Publish**:
    *   Click the green **Publish release** button.

🎉 **Done!** Users can now download the `.vsix` from the "Assets" section of that release.
