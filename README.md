# CBook Pro 🚀

**The Ultimate Polyglot Notebook for VS Code**

CBook Pro is a powerful VS Code extension that brings **Python**, **C**, **C++**, **Java**, and **Rich Markdown** together in a single `.cbook` notebook file. Designed for students, researchers, and developers who need a flexible, multi-language playground.



## ✨ Features

### 🐍 Stateful Python Kernel
*   **History Awareness**: Variables and functions persist across cells, just like Jupyter.
*   **Plotting Support**: Seamlessly render **Matplotlib** and **Seaborn** plots directly in the notebook.
*   **Smart Memory**: Automatically clears execution history when you close the notebook to prevent memory leaks.

### ⚡ Polyglot Execution
Run compiled languages side-by-side with Python!
*   **C / C++**: Write, compile, and run C/C++ code on the fly (uses `gcc`/`g++`).
*   **Java**: 
    *   Execute Java classes instantly (uses `javac`/`java`).
    *   **Smart Snippets**: Run simple Java code (e.g., `System.out.println("Hi")`) without needing to write a `public class Main` wrapper!
*   **Stateless**: Each C/C++/Java cell runs in isolation, perfect for testing algorithms or snippets.

### 🐍 Stateful Python Kernel
*   **History Awareness**: Variables and functions persist across cells, just like Jupyter.
*   **Interactive Input**: Support for `input()`! A VS Code input box will appear when your script asks for input.
*   **Plotting Support**: Seamlessly render **Matplotlib** and **Seaborn** plots directly in the notebook.
*   **Smart Memory**: Automatically clears execution history when you close the notebook to prevent memory leaks.

### 📝 Advanced Markdown Tools
Create beautiful documentation with built-in rich text tools:
*   **Rich Formatting**: Bold, Italic, Highlight, and Red Text with a single click.
*   **Image Resizing**: Insert images with customizable width (e.g., `<img width="500" ... />`).
*   **Tables**: One-click standard Markdown table insertion.

### 📤 Export to HTML
Share your work effortlessly!
*   **One-Click Export**: Convert your entire notebook (code, outputs, plots, and markdown) into a clean, standalone HTML file.
*   **Modern Styling**: Exported HTML comes with a polished, readable CSS theme.

### 🔒 Read-Only Mode
*   **Lock Cells**: Mark specific code cells as "Read-Only" to prevent accidental execution or modification. Perfect for instructions or reference code.

## 🚀 Getting Started

1.  **Install the Extension**: Install `cbook-pro` from the VS Code Marketplace or via `.vsix`.
2.  **Create a Notebook**: Create a new file with the `.cbook` extension (e.g., `lab_report.cbook`).
3.  **Select Kernel**: The "CBook Kernel" should be automatically selected.
4.  **Start Coding**: Add cells and switch languages using the cell language picker (bottom right of the cell).

## ⚙️ Requirements

Ensure you have the following installed and added to your system PATH:

*   **Python**: `python` (for Python cells)
*   **GCC/G++**: `gcc` and `g++` (for C/C++ cells)
*   **Java JDK**: `javac` and `java` (for Java cells)

## 🔧 Configuration

You can customize the compiler paths in VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `cbook.pythonPath` | `python` | Path to the Python executable. |
| `cbook.gccPath` | `gcc` | Path to the GCC compiler. |
| `cbook.gppPath` | `g++` | Path to the G++ compiler. |
| `cbook.javacPath` | `javac` | Path to the Java compiler. |
| `cbook.javaPath` | `java` | Path to the Java runtime. |

## ⌨️ Shortcuts & Commands

| Command | Description |
| :--- | :--- |
| `CBook Pro: Export to HTML` | Export the current notebook to HTML. |
| `CBook Pro: Toggle Read-Only` | Lock/Unlock the selected code cell. |
| `CBook Pro: Insert Image` | Insert an image from your local file system. |
| `CBook Pro: Insert Table` | Insert a 3x3 Markdown table template. |

---

**Enjoy coding with CBook Pro!** 🎉
